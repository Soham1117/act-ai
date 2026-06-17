"""Retrieval tools: search_chunks, get_toc, read_section, expand_chunk,
get_images, query_records. Every tool is scoped (SQL WHERE + RLS) and registers
evidence. Documents are addressed by per-run slugs (doc-0, doc-1 …); the model
never sees raw ids.
"""

from __future__ import annotations

import json

import asyncpg
from pydantic import BaseModel, Field

from act_ai.agent.evidence import RunContext
from act_ai.agent.retrieval import hybrid_search
from act_ai.agent.tools.base import Tool, ToolResult

_READ_SECTION_TOKEN_CAP = 4000


def _jload(v):
    return json.loads(v) if isinstance(v, str) else v


# --------------------------------------------------------------------------- #
# search_chunks
# --------------------------------------------------------------------------- #
class SearchChunksArgs(BaseModel):
    query: str = Field(description="What to search for, in natural language.")
    doc_slugs: list[str] | None = Field(
        default=None, description="Restrict to these document slugs (e.g. ['doc-0']). Omit for all."
    )
    top_k: int = Field(default=12, ge=1, le=30)


class SearchChunks(Tool):
    name = "search_chunks"
    description = (
        "Hybrid semantic + lexical search over the documents you can access. Returns "
        "passages with evidence ids ([E#]) you must cite. Search before answering."
    )
    Args = SearchChunksArgs

    def label(self, args: SearchChunksArgs) -> str:
        scope = ", ".join(args.doc_slugs) if args.doc_slugs else "all documents"
        return f'Searching "{args.query}" in {scope}…'

    async def run(self, args: SearchChunksArgs, ctx: RunContext, conn: asyncpg.Connection) -> ToolResult:
        scope_ids = ctx.allowed_doc_ids
        if args.doc_slugs:
            scope_ids = [d for s in args.doc_slugs if (d := ctx.resolve_slug(s))]
        hits = await hybrid_search(conn, args.query, scope_ids, top_k=args.top_k)
        if not hits:
            return ToolResult({"results": []}, "No passages found")

        rows = await conn.fetch(
            'SELECT c.id, c.content, c.bbox, c.polygon, c."pageNumber", c."documentId", sn.breadcrumb '
            'FROM "Chunk" c LEFT JOIN "StructureNode" sn ON sn.id = c."structureNodeId" '
            "WHERE c.id = ANY($1::text[])",
            [h.chunk_id for h in hits],
        )
        by_id = {r["id"]: r for r in rows}

        results, new_eids = [], []
        for h in hits:
            r = by_id.get(h.chunk_id)
            if r is None:
                continue
            item = ctx.registry.register_chunk(
                chunk_id=r["id"], document_id=r["documentId"], page=r["pageNumber"],
                bbox=_jload(r["bbox"]), polygon=_jload(r["polygon"]),
                breadcrumb=r["breadcrumb"], text=r["content"],
            )
            new_eids.append(item.eid)
            results.append({
                "eid": item.eid, "doc": ctx.slug_for(r["documentId"]),
                "page": r["pageNumber"], "section": r["breadcrumb"], "text": r["content"],
            })
        return ToolResult({"results": results}, f"Found {len(results)} passages", new_eids)


# --------------------------------------------------------------------------- #
# get_toc
# --------------------------------------------------------------------------- #
class GetTocArgs(BaseModel):
    doc_slug: str = Field(description="Document slug, e.g. 'doc-0'.")


class GetToc(Tool):
    name = "get_toc"
    description = "Table of contents (heading tree) of a document — use it to judge scope and coverage."
    Args = GetTocArgs

    def label(self, args: GetTocArgs) -> str:
        return f"Reading the table of contents of {args.doc_slug}…"

    async def run(self, args: GetTocArgs, ctx: RunContext, conn: asyncpg.Connection) -> ToolResult:
        doc_id = ctx.resolve_slug(args.doc_slug)
        if doc_id is None:
            return ToolResult({"error": f"unknown document {args.doc_slug}"}, "Unknown document")
        nodes = await conn.fetch(
            'SELECT id, depth, "headingText", "pageStart", "pageEnd" FROM "StructureNode" '
            'WHERE "documentId" = $1 ORDER BY "pageStart" NULLS FIRST, depth',
            doc_id,
        )
        toc = [
            {"node_id": n["id"], "depth": n["depth"], "heading": n["headingText"],
             "pages": [n["pageStart"], n["pageEnd"]]}
            for n in nodes
        ]
        return ToolResult({"toc": toc}, f"{len(toc)} sections")


# --------------------------------------------------------------------------- #
# read_section
# --------------------------------------------------------------------------- #
class ReadSectionArgs(BaseModel):
    node_id: str = Field(description="A structure node id from get_toc.")


class ReadSection(Tool):
    name = "read_section"
    description = (
        "All chunks under a section (capped ~4k tokens; falls back to a child list "
        "when oversized). Registers each chunk as evidence."
    )
    Args = ReadSectionArgs

    def label(self, args: ReadSectionArgs) -> str:  # noqa: ARG002
        return "Reading a section…"

    async def run(self, args: ReadSectionArgs, ctx: RunContext, conn: asyncpg.Connection) -> ToolResult:
        node = await conn.fetchrow(
            'SELECT id, "documentId", "headingText" FROM "StructureNode" WHERE id = $1', args.node_id
        )
        if node is None or node["documentId"] not in ctx.allowed_doc_ids:
            return ToolResult({"error": "section not in scope"}, "Section out of scope")

        chunks = await conn.fetch(
            'SELECT id, content, bbox, polygon, "pageNumber", "documentId", "tokenCount" '
            'FROM "Chunk" WHERE "structureNodeId" = $1 ORDER BY "pageNumber" NULLS FIRST, id',
            args.node_id,
        )
        total = sum((c["tokenCount"] or 0) for c in chunks)
        if total > _READ_SECTION_TOKEN_CAP:
            children = await conn.fetch(
                'SELECT id, "headingText" FROM "StructureNode" WHERE "parentId" = $1', args.node_id
            )
            return ToolResult(
                {"oversized": True, "children": [{"node_id": c["id"], "heading": c["headingText"]} for c in children]},
                f"Section too large ({total} tokens) — returned {len(children)} children",
            )

        passages, new_eids = [], []
        for c in chunks:
            item = ctx.registry.register_chunk(
                chunk_id=c["id"], document_id=c["documentId"], page=c["pageNumber"],
                bbox=_jload(c["bbox"]), polygon=_jload(c["polygon"]), breadcrumb=node["headingText"],
                text=c["content"],
            )
            new_eids.append(item.eid)
            passages.append({"eid": item.eid, "page": c["pageNumber"], "text": c["content"]})
        return ToolResult(
            {"heading": node["headingText"], "passages": passages},
            f'Read {len(passages)} passages from "{node["headingText"]}"', new_eids,
        )


# --------------------------------------------------------------------------- #
# expand_chunk
# --------------------------------------------------------------------------- #
class ExpandChunkArgs(BaseModel):
    eid: str = Field(description="An evidence id (e.g. 'E3') to expand with neighbors.")


class ExpandChunk(Tool):
    name = "expand_chunk"
    description = "Prev/next neighboring chunks for an evidence item — late expansion for surrounding context."
    Args = ExpandChunkArgs

    def label(self, args: ExpandChunkArgs) -> str:
        return f"Expanding {args.eid} with surrounding context…"

    async def run(self, args: ExpandChunkArgs, ctx: RunContext, conn: asyncpg.Connection) -> ToolResult:
        item = ctx.registry.get(args.eid)
        if item is None or item.source_kind != "chunk":
            return ToolResult({"error": f"unknown chunk evidence {args.eid}"}, "Unknown evidence id")
        anchor = await conn.fetchrow(
            'SELECT id, "structureNodeId", "documentId" FROM "Chunk" WHERE id = $1', item.source_id
        )
        if anchor is None:
            return ToolResult({"error": "chunk gone"}, "Chunk unavailable")

        neighbors = await conn.fetch(
            'SELECT id, content, bbox, polygon, "pageNumber", "documentId" FROM "Chunk" '
            'WHERE "structureNodeId" IS NOT DISTINCT FROM $1 AND "documentId" = $2 '
            'ORDER BY "pageNumber" NULLS FIRST, id',
            anchor["structureNodeId"], anchor["documentId"],
        )
        ids = [c["id"] for c in neighbors]
        idx = ids.index(anchor["id"]) if anchor["id"] in ids else -1
        window = neighbors[max(0, idx - 1): idx + 2] if idx >= 0 else neighbors[:1]

        passages, new_eids = [], []
        for c in window:
            ev = ctx.registry.register_chunk(
                chunk_id=c["id"], document_id=c["documentId"], page=c["pageNumber"],
                bbox=_jload(c["bbox"]), polygon=_jload(c["polygon"]), breadcrumb=item.breadcrumb,
                text=c["content"],
            )
            new_eids.append(ev.eid)
            passages.append({"eid": ev.eid, "page": c["pageNumber"], "text": c["content"]})
        return ToolResult({"passages": passages}, f"Expanded to {len(passages)} neighboring passages", new_eids)


# --------------------------------------------------------------------------- #
# get_images
# --------------------------------------------------------------------------- #
class GetImagesArgs(BaseModel):
    doc_slug: str = Field(description="Document slug, e.g. 'doc-0'.")
    figure_ref: str | None = Field(default=None, description="Exact figure ref for a direct lookup.")


class GetImages(Tool):
    name = "get_images"
    description = "Find figures/tables in a document by exact figure_ref or list them. Returns page + bbox."
    Args = GetImagesArgs

    def label(self, args: GetImagesArgs) -> str:
        return f"Looking up figures in {args.doc_slug}…"

    async def run(self, args: GetImagesArgs, ctx: RunContext, conn: asyncpg.Connection) -> ToolResult:
        doc_id = ctx.resolve_slug(args.doc_slug)
        if doc_id is None:
            return ToolResult({"error": "unknown document"}, "Unknown document")
        if args.figure_ref:
            rows = await conn.fetch(
                'SELECT id, "pageNumber", caption, "figureRefNorm", bbox FROM "DocImage" '
                'WHERE "documentId" = $1 AND "figureRefNorm" = $2 LIMIT 10',
                doc_id, args.figure_ref,
            )
        else:
            rows = await conn.fetch(
                'SELECT id, "pageNumber", caption, "figureRefNorm", bbox FROM "DocImage" '
                'WHERE "documentId" = $1 LIMIT 10',
                doc_id,
            )
        results = [
            {"image_id": r["id"], "page": r["pageNumber"], "caption": r["caption"],
             "figure_ref": r["figureRefNorm"], "bbox": _jload(r["bbox"])}
            for r in rows
        ]
        return ToolResult({"images": results}, f"Found {len(results)} figures")


# --------------------------------------------------------------------------- #
# query_records  (the safe structured/"SQL" tool — no raw SQL from the model)
# --------------------------------------------------------------------------- #
class QueryRecordsArgs(BaseModel):
    doc_slugs: list[str] | None = Field(
        default=None, description="Restrict to these document slugs. Omit for all accessible."
    )
    contains: dict[str, str] | None = Field(
        default=None, description="Exact field matches on a record row, e.g. {'part_no': 'BOLT-001'}."
    )
    query: str | None = Field(default=None, description="Natural-language semantic match over rows.")
    top_k: int = Field(default=12, ge=1, le=50)


class QueryRecords(Tool):
    name = "query_records"
    description = (
        "Look up structured records (BOM lines, tool records, spreadsheet rows). "
        "Use `contains` for exact field matches or `query` for semantic search. "
        "Returns rows as evidence ([E#]) to cite. Scoped to your accessible documents."
    )
    Args = QueryRecordsArgs

    def label(self, args: QueryRecordsArgs) -> str:
        what = args.contains or args.query or "records"
        return f"Querying records: {what}…"

    async def run(self, args: QueryRecordsArgs, ctx: RunContext, conn: asyncpg.Connection) -> ToolResult:
        scope_ids = ctx.allowed_doc_ids
        if args.doc_slugs:
            scope_ids = [d for s in args.doc_slugs if (d := ctx.resolve_slug(s))]
        if not scope_ids:
            return ToolResult({"rows": []}, "No records in scope")

        where = ['r."documentId" = ANY($1::text[])']
        params: list = [scope_ids]
        if args.contains:
            params.append(json.dumps(args.contains))
            where.append(f'r."dataJson" @> ${len(params)}::jsonb')

        order = 'ORDER BY r.id'
        if args.query:
            vectors = await embed_one(args.query)
            if vectors is not None:
                params.append(vectors)
                where.append('r."rowEmbedding" IS NOT NULL')
                order = f'ORDER BY r."rowEmbedding" <=> ${len(params)}::vector'
        params.append(args.top_k)
        sql = (
            'SELECT r.id, r."documentId", r."dataJson", rt.name AS table_name '
            'FROM "RecordRow" r JOIN "RecordTable" rt ON rt.id = r."recordTableId" '
            f'WHERE {" AND ".join(where)} {order} LIMIT ${len(params)}'
        )
        rows = await conn.fetch(sql, *params)

        results, new_eids = [], []
        for r in rows:
            data = _jload(r["dataJson"])
            text = f'{r["table_name"]}: ' + " | ".join(f"{k}: {v}" for k, v in data.items())
            item = ctx.registry.register_row(
                row_id=r["id"], document_id=r["documentId"], text=text, breadcrumb=r["table_name"]
            )
            new_eids.append(item.eid)
            results.append({"eid": item.eid, "doc": ctx.slug_for(r["documentId"]),
                            "table": r["table_name"], "data": data})
        return ToolResult({"rows": results}, f"Found {len(results)} records", new_eids)


async def embed_one(query: str):
    from act_ai.ingestion.embed import embed_texts, to_pgvector

    vecs = await embed_texts([query])
    if not vecs or not vecs[0]:
        return None
    return to_pgvector(vecs[0])
