"""Ingestion orchestrator. Runs as the worker (owner DB role, RLS-bypassing).

Flow:
  load doc → status PARSING
    PDF/DOCX → Marker (S3-cached) → normalize → nodes/chunks/tables/images
    CSV/XLSX → pandas → tables
  → status EMBEDDING → embed chunk + row texts (Bedrock or fake)
  → transactional commit (nodes, chunks, images, tables, rows)
  → status READY     (on failure: FAILED + reason)
"""

from __future__ import annotations

import json

import asyncpg

from act_ai.db import new_id, owner_conn
from act_ai.ingestion import s3io
from act_ai.ingestion.datalab import parse_document, payload_bytes
from act_ai.ingestion.embed import embed_texts, to_pgvector
from act_ai.ingestion.marker_normalize import NormalizedDoc, normalize
from act_ai.ingestion.structured import ParsedTable, parse_structured


async def _set_status(conn: asyncpg.Connection, doc_id: str, status: str, reason: str | None = None) -> None:
    await conn.execute(
        'UPDATE "KnowledgeDocument" SET status=$1, "failureReason"=$2, "updatedAt"=now() WHERE id=$3',
        status,
        reason,
        doc_id,
    )


async def _load_doc(conn: asyncpg.Connection, doc_id: str) -> asyncpg.Record | None:
    return await conn.fetchrow(
        'SELECT id, "s3Key", "fileKind", "mimeType", "sourceFilename", checksum '
        'FROM "KnowledgeDocument" WHERE id=$1',
        doc_id,
    )


def _build_from_structured(tables: list[ParsedTable]) -> NormalizedDoc:
    """Structured files have no prose tree; wrap their tables in a NormalizedDoc."""
    doc = NormalizedDoc()
    doc.tables = tables
    return doc


async def _commit(conn: asyncpg.Connection, doc_id: str, nd: NormalizedDoc) -> dict:
    # Embed chunk texts + row texts together.
    chunk_texts = [c.content for c in nd.chunks]
    row_text_index: list[tuple[int, int]] = []  # (table_idx, row_idx)
    row_texts: list[str] = []
    for ti, t in enumerate(nd.tables):
        for ri, rt in enumerate(t.row_texts or []):
            row_text_index.append((ti, ri))
            row_texts.append(rt)

    chunk_vecs = await embed_texts(chunk_texts)
    row_vecs = await embed_texts(row_texts)

    async with conn.transaction():
        # Clear any prior partial ingest for idempotency.
        await conn.execute('DELETE FROM "Chunk" WHERE "documentId"=$1', doc_id)
        await conn.execute('DELETE FROM "StructureNode" WHERE "documentId"=$1', doc_id)
        await conn.execute('DELETE FROM "DocImage" WHERE "documentId"=$1', doc_id)
        await conn.execute('DELETE FROM "RecordRow" WHERE "documentId"=$1', doc_id)
        await conn.execute('DELETE FROM "RecordTable" WHERE "documentId"=$1', doc_id)

        # Structure nodes (index -> id).
        node_ids: list[str] = []
        for n in nd.nodes:
            nid = new_id()
            await conn.execute(
                'INSERT INTO "StructureNode" (id,"documentId","parentId",depth,"headingText",breadcrumb,"pageStart") '
                "VALUES ($1,$2,NULL,$3,$4,$5,$6)",
                nid, doc_id, n.depth, n.heading_text, n.breadcrumb, n.page_start,
            )
            node_ids.append(nid)

        # Chunks (+ embeddings).
        for c, vec in zip(nd.chunks, chunk_vecs):
            sn = node_ids[c.node_index] if (c.node_index is not None and c.node_index < len(node_ids)) else None
            await conn.execute(
                'INSERT INTO "Chunk" (id,"documentId","structureNodeId",content,"pageNumber",bbox,embedding,"createdAt") '
                "VALUES ($1,$2,$3,$4,$5,$6,$7::vector,now())",
                new_id(), doc_id, sn, c.content, c.page_number,
                json.dumps(c.bbox) if c.bbox is not None else None,
                to_pgvector(vec),
            )

        # Images.
        for im in nd.images:
            await conn.execute(
                'INSERT INTO "DocImage" (id,"documentId","pageNumber",bbox,caption,"figureRefNorm","s3Key") '
                "VALUES ($1,$2,$3,$4,$5,$6,$7)",
                new_id(), doc_id, im.page_number,
                json.dumps(im.bbox) if im.bbox is not None else None,
                im.caption, im.figure_ref_norm, "",
            )

        # Record tables + rows (+ row embeddings).
        for ti, t in enumerate(nd.tables):
            tid = new_id()
            await conn.execute(
                'INSERT INTO "RecordTable" (id,"documentId",name,"schemaJson","createdAt") VALUES ($1,$2,$3,$4,now())',
                tid, doc_id, t.name, json.dumps(t.columns),
            )
            for ri, rec in enumerate(t.rows):
                # find matching embedding
                vec = None
                for k, (tt, rr) in enumerate(row_text_index):
                    if tt == ti and rr == ri:
                        vec = row_vecs[k]
                        break
                if vec is not None:
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

    return {
        "nodes": len(nd.nodes),
        "chunks": len(nd.chunks),
        "images": len(nd.images),
        "tables": len(nd.tables),
        "rows": sum(len(t.rows) for t in nd.tables),
    }


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
                nd = _build_from_structured(tables)
            elif kind in ("PDF", "DOCX"):
                cached = s3io.get_cached_parse(doc["checksum"])
                payload = json.loads(cached) if cached else None
                if payload is None:
                    payload = await parse_document(data, doc["sourceFilename"], doc["mimeType"])
                    s3io.put_cached_parse(doc["checksum"], payload_bytes(payload))
                nd = normalize(payload)
            else:
                raise RuntimeError(f"unsupported file kind: {kind}")

            await _set_status(conn, doc_id, "EMBEDDING")
            stats = await _commit(conn, doc_id, nd)
            await _set_status(conn, doc_id, "READY")
            return stats
        except Exception as exc:  # noqa: BLE001 - record and re-raise for the worker
            await _set_status(conn, doc_id, "FAILED", reason=str(exc)[:500])
            raise
