"""Embeddings for ingestion. Uses Bedrock (Titan v2, 1024-d) via the gateway, or
a deterministic local fallback when settings.embed_fake is set (dev/tests without
AWS access)."""

from __future__ import annotations

import hashlib
import math

from act_ai.config import get_settings


def _fake_embedding(text: str, dims: int) -> list[float]:
    """Deterministic pseudo-embedding from the text hash, L2-normalized. Stable so
    tests are reproducible; NOT semantically meaningful."""
    vec: list[float] = []
    counter = 0
    while len(vec) < dims:
        h = hashlib.sha256(f"{counter}:{text}".encode()).digest()
        for i in range(0, len(h), 4):
            if len(vec) >= dims:
                break
            n = int.from_bytes(h[i : i + 4], "big")
            vec.append((n / 2**32) * 2 - 1)  # [-1, 1)
        counter += 1
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    s = get_settings()
    if s.embed_fake:
        return [_fake_embedding(t, s.embed_dims) for t in texts]

    # Real path: batch through the Bedrock gateway.
    from act_ai.llm.gateway import embed as bedrock_embed

    out: list[list[float]] = []
    for i in range(0, len(texts), s.embed_batch_size):
        out.extend(await bedrock_embed(texts[i : i + s.embed_batch_size]))
    return out


def to_pgvector(vec: list[float]) -> str:
    """Format a vector for `$n::vector` insertion (avoids needing a codec)."""
    return "[" + ",".join(repr(x) for x in vec) + "]"
