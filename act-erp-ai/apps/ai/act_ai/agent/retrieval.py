"""Hybrid retrieval — pgvector semantic + tsv lexical, RRF fusion, heading boost.

Ported from relearn, adapted to our Prisma schema (quoted PascalCase tables,
camelCase columns, text doc ids) and asyncpg. Scoped to the run's allowed
documents (app-layer WHERE) on top of RLS (defense-in-depth).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

import asyncpg

from act_ai.ingestion.embed import embed_texts, to_pgvector

_RRF_K = 60.0
_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")
_HEADING_MATCH_BOOST = 0.02


@dataclass
class FusedChunk:
    chunk_id: str
    document_id: str
    structure_node_id: str | None
    page_number: int | None
    heading_text: str | None
    sem_rank: int | None = None
    lex_rank: int | None = None
    heading_match: bool = False
    fused_score: float = 0.0


def _or_tsquery(query: str) -> str:
    return " | ".join(_TOKEN_RE.findall(query))


async def _vector_search(
    conn: asyncpg.Connection, query: str, doc_ids: list[str], top_k: int
) -> list[tuple]:
    vectors = await embed_texts([query])
    if not vectors or not vectors[0]:
        return []
    qv = vectors[0]
    if any(not math.isfinite(v) for v in qv) or all(v == 0.0 for v in qv):
        return []
    sql = """
        SELECT c.id, c."documentId", c."structureNodeId", c."pageNumber", sn."headingText"
        FROM "Chunk" c
        LEFT JOIN "StructureNode" sn ON sn.id = c."structureNodeId"
        WHERE c.embedding IS NOT NULL AND c."documentId" = ANY($1::text[])
        ORDER BY c.embedding <=> $2::vector
        LIMIT $3
    """
    return await conn.fetch(sql, doc_ids, to_pgvector(qv), top_k)


async def _fulltext_search(
    conn: asyncpg.Connection, query: str, doc_ids: list[str], top_k: int
) -> list[tuple]:
    q_or = _or_tsquery(query)
    if not q_or:
        return []
    sql = """
        SELECT c.id, c."documentId", c."structureNodeId", c."pageNumber", sn."headingText",
               (sn."headingText" IS NOT NULL
                AND to_tsvector('english', sn."headingText") @@ to_tsquery('english', $1)
               ) AS heading_match
        FROM "Chunk" c
        LEFT JOIN "StructureNode" sn ON sn.id = c."structureNodeId"
        WHERE c."documentId" = ANY($2::text[]) AND (
            c.tsv @@ to_tsquery('english', $1)
            OR (sn."headingText" IS NOT NULL
                AND to_tsvector('english', sn."headingText") @@ to_tsquery('english', $1))
        )
        ORDER BY GREATEST(
            ts_rank_cd(c.tsv, to_tsquery('english', $1)),
            ts_rank_cd(to_tsvector('english', coalesce(sn."headingText", '')), to_tsquery('english', $1))
        ) DESC
        LIMIT $3
    """
    return await conn.fetch(sql, q_or, doc_ids, top_k)


def _fuse(sem: list[tuple], lex: list[tuple], top_k: int) -> list[FusedChunk]:
    by_chunk: dict[str, FusedChunk] = {}

    def ensure(row) -> FusedChunk:
        return by_chunk.setdefault(
            row[0], FusedChunk(row[0], row[1], row[2], row[3], row[4])
        )

    for rank, row in enumerate(sem, start=1):
        c = ensure(row)
        c.sem_rank = rank if c.sem_rank is None else min(c.sem_rank, rank)
    for rank, row in enumerate(lex, start=1):
        c = ensure(row)
        c.lex_rank = rank if c.lex_rank is None else min(c.lex_rank, rank)
        c.heading_match = c.heading_match or bool(row[5])

    for c in by_chunk.values():
        score = 0.0
        if c.sem_rank is not None:
            score += 1.0 / (_RRF_K + c.sem_rank)
        if c.lex_rank is not None:
            score += 1.0 / (_RRF_K + c.lex_rank)
        if c.heading_match:
            score += _HEADING_MATCH_BOOST
        c.fused_score = score

    return sorted(by_chunk.values(), key=lambda c: c.fused_score, reverse=True)[:top_k]


async def hybrid_search(
    conn: asyncpg.Connection, query: str, doc_ids: list[str], *, top_k: int = 12
) -> list[FusedChunk]:
    """Semantic + lexical retrieval in scope, RRF-fused. Empty scope → []."""
    if not doc_ids:
        return []
    sem = await _vector_search(conn, query, doc_ids, top_k)
    lex = await _fulltext_search(conn, query, doc_ids, top_k)
    return _fuse(sem, lex, top_k)
