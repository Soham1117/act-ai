"""LLM + embeddings gateway via litellm -> Amazon Bedrock.

One place to call models; role->model mapping lives in models.yaml. Bedrock auth
is via the task IAM role (no API keys). Phase 5 wires retrieval to `embed()`;
Phase 6 wires the agent loop to `acompletion`.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from act_ai.config import get_settings

_MODELS_PATH = Path(__file__).with_name("models.yaml")


@lru_cache
def _roles() -> dict[str, str]:
    data = yaml.safe_load(_MODELS_PATH.read_text())
    return data["roles"]


def model_for(role: str) -> str:
    return _roles()[role]


async def embed(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts with the configured embeddings model (Titan v2, 1024-d)."""
    import litellm

    s = get_settings()
    resp = await litellm.aembedding(
        model=model_for("embeddings"),
        input=texts,
        aws_region_name=s.aws_region,
    )
    return [d["embedding"] for d in resp["data"]]


async def acompletion(messages: list[dict], tools: list[dict] | None = None, **kwargs):
    """Streaming/non-streaming chat completion with the agent model. Used by the
    agent loop in Phase 6."""
    import litellm

    s = get_settings()
    return await litellm.acompletion(
        model=model_for("agent"),
        messages=messages,
        tools=tools,
        aws_region_name=s.aws_region,
        **kwargs,
    )
