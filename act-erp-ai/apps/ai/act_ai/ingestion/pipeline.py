"""Ingestion orchestrator. Runs as the worker (owner DB role, RLS-bypassing).

Flow:
  load doc → status PARSING
    PDF/DOCX → Marker (S3-cached) → normalize_marker_tree → tree_mapper → gates
    CSV/XLSX → pandas → tables
  → status EMBEDDING → embed chunk + row texts
  → transactional commit → status READY   (on failure: FAILED + reason)

The PDF path stores everything the visualizer and agent need: 1-based page
numbers, Marker-coordinate bbox/polygon per chunk, heading hierarchy with
parents/breadcrumbs, token counts, figure images in S3, and per-document
pageDimensions (0-based page index → [w, h] in Marker coordinates).
"""

from __future__ import annotations

import base64
import json
from typing import Any

import asyncpg

from act_ai.db import new_id, owner_conn
from act_ai.ingestion import s3io
from act_ai.ingestion.datalab import parse_document, payload_bytes
from act_ai.ingestion.embed import embed_texts, to_pgvector
from act_ai.ingestion.gates import run_quality_gates
from act_ai.ingestion.marker_payload import normalize_marker_payload
from act_ai.ingestion.normalize_tree import normalize_marker_tree
from act_ai.ingestion.structured import ParsedTable, parse_structured
from act_ai.ingestion.tree_mapper import (
    MappedDocument,
    map_marker_document_tree,
    parse_page_number,
)


async def _set_status(conn: asyncpg.Connection, doc_id: str, status: str, reason: str | None = None) -> None:
    await conn.execute(
        'UPDATE "KnowledgeDocument" SET status=$1, "failureReason"=$2, "updatedAt"=now() WHERE id=$3',
        status,
        reason,
        doc_id,
    )


async def _load_doc(conn: asyncpg.Connection, doc_id: str) -> asyncpg.Record | None:
    return await conn.fetchrow(
        'SELECT id, title, "s3Key", "fileKind", "mimeType", "sourceFilename", checksum '
        'FROM "KnowledgeDocument" WHERE id=$1',
        doc_id,
    )


# --------------------------------------------------------------------------- #
# PDF/DOCX (Marker) path
# --------------------------------------------------------------------------- #


def _page_dimensions(document_root: dict[str, Any]) -> dict[str, list[float]]:
    """{0-based page index: [width, height]} in Marker coordinates — the one
    coordinate space the visualizer overlay uses."""
    dims: dict[str, list[float]] = {}
    for page in document_root.get("children") or []:
        if not isinstance(page, dict) or page.get("block_type") != "Page":
            continue
        pnum = parse_page_number(page.get("id") if isinstance(page.get("id"), str) else None)
        bbox = page.get("bbox")
        if pnum is not None and isinstance(bbox, list) and len(bbox) >= 4:
            dims[str(pnum)] = [float(bbox[2]), float(bbox[3])]
    return dims


def _upload_images(document_root: dict[str, Any], checksum: str) -> dict[str, str]:
    """Decode base64 images from Marker blocks → S3. {marker_block_id: s3_key}."""
    keys: dict[str, str] = {}
    n = 0

    def walk(node: dict[str, Any]) -> None:
        nonlocal n
        imgs = node.get("images")
        if isinstance(imgs, dict):
            for bid, b64 in imgs.items():
                if not isinstance(b64, str) or len(b64) < 8 or str(bid) in keys:
                    continue
                try:
                    data = base64.b64decode(b64)
                except Exception:
                    continue
                key = f"images/{checksum}/{n}.png"
                n += 1
                s3io.put_image(key, data)
                keys[str(bid)] = key
        for c in node.get("children") or []:
            if isinstance(c, dict):
                walk(c)

    walk(document_root)
    return keys


def _page_1based(page: int | None) -> int | None:
    return page + 1 if page is not None else None


async def _commit_pdf(
    conn: asyncpg.Connection,
    doc_id: str,
    mapped: MappedDocument,
    page_dims: dict[str, list[float]],
    image_keys: dict[str, str],
) -> dict:
    chunks = [c for c in mapped.chunks if c.content.strip()]
    chunk_vecs = await embed_texts([c.content for c in chunks])

    async with conn.transaction():
        # Clear any prior partial ingest for idempotency.
        await conn.execute('DELETE FROM "Chunk" WHERE "documentId"=$1', doc_id)
        await conn.execute('DELETE FROM "StructureNode" WHERE "documentId"=$1', doc_id)
        await conn.execute('DELETE FROM "DocImage" WHERE "documentId"=$1', doc_id)
        await conn.execute('DELETE FROM "RecordRow" WHERE "documentId"=$1', doc_id)
        await conn.execute('DELETE FROM "RecordTable" WHERE "documentId"=$1', doc_id)

        # Structure nodes — creation order guarantees parents precede children.
        for node in mapped.structure_nodes:
            await conn.execute(
                'INSERT INTO "StructureNode" (id,"documentId","parentId",depth,"headingText",breadcrumb,"pageStart","pageEnd") '
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
                str(node.id), doc_id,
                str(node.parent_node_id) if node.parent_node_id else None,
                node.depth, node.heading_text, node.heading_breadcrumb,
                _page_1based(node.page_start), _page_1based(node.page_end),
            )

        # Chunks (+ embeddings). bbox/polygon stay in Marker coordinates.
        for c, vec in zip(chunks, chunk_vecs):
            await conn.execute(
                'INSERT INTO "Chunk" (id,"documentId","structureNodeId",content,"contentHtml","pageNumber",bbox,polygon,"tokenCount",embedding,"createdAt") '
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,now())",
                str(c.id), doc_id,
                str(c.structure_node_id) if c.structure_node_id else None,
                c.content, c.content_html, _page_1based(c.page_number),
                json.dumps(c.bbox) if c.bbox is not None else None,
                json.dumps(c.polygon) if c.polygon is not None else None,
                c.token_count, to_pgvector(vec),
            )

        # Images (figureRefNorm is unique per document — dedupe defensively).
        seen_refs: set[str] = set()
        for im in mapped.images:
            ref = im.figure_ref_norm
            if ref in seen_refs:
                ref = None
            elif ref:
                seen_refs.add(ref)
            await conn.execute(
                'INSERT INTO "DocImage" (id,"documentId","pageNumber",bbox,caption,"figureRefNorm","s3Key") '
                "VALUES ($1,$2,$3,$4,$5,$6,$7)",
                str(im.id), doc_id, _page_1based(im.page_number),
                json.dumps(im.bbox) if im.bbox is not None else None,
                im.caption, ref, image_keys.get(im.marker_block_id, ""),
            )

    await conn.execute(
        'UPDATE "KnowledgeDocument" SET "pageDimensions"=$1::jsonb, "updatedAt"=now() WHERE id=$2',
        json.dumps(page_dims), doc_id,
    )
    return {
        "nodes": len(mapped.structure_nodes),
        "chunks": len(chunks),
        "images": len(mapped.images),
        "pages": len(page_dims),
    }


# --------------------------------------------------------------------------- #
# CSV/XLSX (structured) path
# --------------------------------------------------------------------------- #


async def _commit_structured(conn: asyncpg.Connection, doc_id: str, tables: list[ParsedTable]) -> dict:
    row_texts = [rt for t in tables for rt in (t.row_texts or [])]
    row_vecs = await embed_texts(row_texts)

    async with conn.transaction():
        await conn.execute('DELETE FROM "RecordRow" WHERE "documentId"=$1', doc_id)
        await conn.execute('DELETE FROM "RecordTable" WHERE "documentId"=$1', doc_id)

        vi = 0
        for t in tables:
            tid = new_id()
            await conn.execute(
                'INSERT INTO "RecordTable" (id,"documentId",name,"schemaJson","createdAt") VALUES ($1,$2,$3,$4,now())',
                tid, doc_id, t.name, json.dumps(t.columns),
            )
            for ri, rec in enumerate(t.rows):
                vec = row_vecs[vi] if ri < len(t.row_texts or []) else None
                if vec is not None:
                    vi += 1
                    await conn.execute(
                        'INSERT INTO "RecordRow" (id,"recordTableId","documentId","dataJson","rowEmbedding") '
                        "VALUES ($1,$2,$3,$4,$5::vector)",
                        new_id(), tid, doc_id, json.dumps(rec), to_pgvector(vec),
                    )
                else:
                    await conn.execute(
                        'INSERT INTO "RecordRow" (id,"recordTableId","documentId","dataJson") VALUES ($1,$2,$3,$4)',
                        new_id(), tid, doc_id, json.dumps(rec),
                    )

    return {"tables": len(tables), "rows": sum(len(t.rows) for t in tables)}


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


async def ingest_document(doc_id: str) -> dict:
    async with owner_conn() as conn:
        doc = await _load_doc(conn, doc_id)
        if doc is None:
            raise RuntimeError(f"document {doc_id} not found")
        await _set_status(conn, doc_id, "PARSING")

        try:
            data = s3io.download_bytes(doc["s3Key"])
            kind = doc["fileKind"]

            if kind in ("CSV", "XLSX"):
                tables = parse_structured(kind, data, source_name=doc["sourceFilename"])
                await _set_status(conn, doc_id, "EMBEDDING")
                stats = await _commit_structured(conn, doc_id, tables)
            elif kind in ("PDF", "DOCX"):
                cached = s3io.get_cached_parse(doc["checksum"])
                payload = json.loads(cached) if cached else None
                if payload is None:
                    payload = await parse_document(data, doc["sourceFilename"], doc["mimeType"])
                    s3io.put_cached_parse(doc["checksum"], payload_bytes(payload))

                root, _envelope = normalize_marker_payload(payload)
                normalize_marker_tree(root)
                mapped = map_marker_document_tree(root, doc_id, document_title=doc["title"])
                page_dims = _page_dimensions(root)

                gates = run_quality_gates(mapped, page_count=len(page_dims))
                if not gates.passed:
                    raise RuntimeError("quality gates failed: " + "; ".join(gates.failures))

                image_keys = _upload_images(root, doc["checksum"])
                await _set_status(conn, doc_id, "EMBEDDING")
                stats = await _commit_pdf(conn, doc_id, mapped, page_dims, image_keys)
            else:
                raise RuntimeError(f"unsupported file kind: {kind}")

            await _set_status(conn, doc_id, "READY")
            return stats
        except Exception as exc:  # noqa: BLE001 - record and re-raise for the worker
            await _set_status(conn, doc_id, "FAILED", reason=str(exc)[:500])
            raise
