"""Embeddings for ingestion. Uses Bedrock (Titan v2, 1024-d) via the gateway, or
a deterministic local fallback when settings.embed_fake is set (dev/tests without
AWS access)."""

from __future__ import annotations

import hashlib
import math
import threading

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


_local_model = None
_local_lock = threading.Lock()


def _local_embed(texts: list[str]) -> list[list[float]]:
    """Local sentence-transformers model (1024-d, L2-normalized). Loaded once and
    encoded under a lock — concurrent ingests must not each load a model copy or
    encode in parallel (memory). No API quota, so nothing can be rate-limited."""
    global _local_model
    with _local_lock:
        if _local_model is None:
            from sentence_transformers import SentenceTransformer

            _local_model = SentenceTransformer(get_settings().embed_local_model)
        vecs = _local_model.encode(texts, normalize_embeddings=True, batch_size=32)
    return [v.tolist() for v in vecs]


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    s = get_settings()
    if s.embed_fake:
        return [_fake_embedding(t, s.embed_dims) for t in texts]
    if s.embed_local:
        import asyncio

        return await asyncio.to_thread(_local_embed, texts)

    # Remote path: batch through the LLM gateway (Bedrock/Gemini).
    from act_ai.llm.gateway import embed as gateway_embed

    out: list[list[float]] = []
    for i in range(0, len(texts), s.embed_batch_size):
        out.extend(await gateway_embed(texts[i : i + s.embed_batch_size]))
    return out


def to_pgvector(vec: list[float]) -> str:
    """Format a vector for `$n::vector` insertion (avoids needing a codec)."""
    return "[" + ",".join(repr(x) for x in vec) + "]"
