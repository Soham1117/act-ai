"""Async Postgres access via asyncpg against the Prisma-owned schema.

The agent/worker run as a read-mostly role with RLS enabled. `scoped_conn()`
acquires a connection and sets `app.allowed_docs` so RLS policies bound every
query to the caller's allowed documents (defense-in-depth behind the app-layer
WHERE filters). See ARCHITECTURE.md §6.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

import asyncpg

from act_ai.config import get_settings

# Agent pool: connects as the read-mostly RLS role (db_dsn).
_pool: asyncpg.Pool | None = None
# Worker/ingestion pool: connects as the table owner (database_url) so writes
# bypass RLS. Never used to serve user-scoped reads.
_owner_pool: asyncpg.Pool | None = None


def new_id() -> str:
    """Generate a text id for rows the worker inserts (Prisma cuid columns have
    no DB default; any unique string is valid)."""
    return uuid.uuid4().hex


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(dsn=get_settings().db_dsn, min_size=1, max_size=10)
    return _pool


async def init_owner_pool() -> asyncpg.Pool:
    global _owner_pool
    if _owner_pool is None:
        _owner_pool = await asyncpg.create_pool(
            dsn=get_settings().database_url, min_size=1, max_size=5
        )
    return _owner_pool


@asynccontextmanager
async def owner_conn() -> AsyncIterator[asyncpg.Connection]:
    """Acquire an owner connection (RLS-bypassing) for ingestion writes."""
    pool = await init_owner_pool()
    async with pool.acquire() as conn:
        yield conn


async def close_pool() -> None:
    global _pool, _owner_pool
    if _pool is not None:
        await _pool.close()
        _pool = None
    if _owner_pool is not None:
        await _owner_pool.close()
        _owner_pool = None


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
