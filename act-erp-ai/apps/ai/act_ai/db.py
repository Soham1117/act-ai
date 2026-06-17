"""Async Postgres access via asyncpg against the Prisma-owned schema.

The agent/worker run as a read-mostly role with RLS enabled. `scoped_conn()`
acquires a connection and sets `app.allowed_docs` so RLS policies bound every
query to the caller's allowed documents (defense-in-depth behind the app-layer
WHERE filters). See ARCHITECTURE.md §6.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

import asyncpg
from pgvector.asyncpg import register_vector

from act_ai.config import get_settings

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=get_settings().db_dsn,
            min_size=1,
            max_size=10,
            init=_init_conn,
        )
    return _pool


async def _init_conn(conn: asyncpg.Connection) -> None:
    await register_vector(conn)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def scoped_conn(allowed_doc_ids: Sequence[str]) -> AsyncIterator[asyncpg.Connection]:
    """Acquire a connection scoped to `allowed_doc_ids` via RLS session setting.

    Use a transaction so SET LOCAL is bound to this connection's scope only.
    """
    pool = await init_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # text[] array literal (KnowledgeDocument.id is a cuid).
            # Empty -> '{}' which matches nothing (fail-closed under RLS).
            arr = "{" + ",".join(allowed_doc_ids) + "}"
            await conn.execute("SELECT set_config('app.allowed_docs', $1, true)", arr)
            yield conn
