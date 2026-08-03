"""LLM + embeddings gateway via litellm. Provider is inferred from the model id
(see models.yaml): `bedrock/*` uses the task IAM role + region; `gemini/*` uses
GEMINI_API_KEY. One place to call models; role→model mapping is config-driven.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from act_ai.config import get_settings

_MODELS_PATH = Path(__file__).with_name("models.yaml")


@lru_cache
def _roles() -> dict[str, str]:
    return yaml.safe_load(_MODELS_PATH.read_text())["roles"]


def model_for(role: str) -> str:
    # Env overrides (prod → Bedrock) win over models.yaml (local → Gemini).
    s = get_settings()
    if role in ("agent", "small") and s.agent_model:
        return s.agent_model
    if role == "embeddings" and s.embed_model:
        return s.embed_model
    return _roles()[role]


def provider_kwargs(model: str) -> dict:
    """Provider-specific call kwargs. Region only matters for Bedrock."""
    if model.startswith("bedrock/"):
        return {"aws_region_name": get_settings().aws_region}
    return {}


async def embed(texts: list[str]) -> list[list[float]]:
    """Embed a batch with the configured embeddings model at embed_dims (1024).
    `dimensions` maps to Titan's outputDimensions / Gemini's output_dimensionality."""
    import litellm

    model = model_for("embeddings")
    resp = await litellm.aembedding(
        model=model,
        input=texts,
        dimensions=get_settings().embed_dims,
        **provider_kwargs(model),
    )
    return [d["embedding"] for d in resp["data"]]


async def acompletion(messages: list[dict], tools: list[dict] | None = None, **kwargs):
    import litellm

    model = model_for("agent")
    return await litellm.acompletion(
        model=model, messages=messages, tools=tools, **provider_kwargs(model), **kwargs
    )
