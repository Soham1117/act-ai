"""Streaming completion in one internal format via litellm → Bedrock.

The agent loop consumes `Delta` items and never sees provider quirks. Tool-call
fragments (streamed piecewise by index) are assembled here and surfaced once on
the terminal delta. Ported from the v1 reference implementation; the only change is litellm (Bedrock)
instead of a raw OpenAI client.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from act_ai.llm.gateway import model_for, provider_kwargs


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict

    @property
    def raw_arguments(self) -> str:
        return json.dumps(self.arguments)


@dataclass
class Delta:
    thinking: str = ""
    text: str = ""
    done: bool = False
    tool_calls: list[ToolCall] = field(default_factory=list)


@dataclass
class AssistantTurn:
    text: str
    thinking: str
    tool_calls: list[ToolCall]


async def stream_turn(
    role: str, messages: list[dict], *, tools: list[dict] | None = None
) -> AsyncIterator[Delta]:
    """Stream one assistant turn. Yields live thinking/text deltas, then one
    terminal Delta(done=True) with the assembled turn."""
    import litellm

    model = model_for(role)
    # num_retries absorbs free-tier per-minute 429 bursts between agent-loop steps
    # (litellm backs off per the provider's RetryInfo) instead of killing the run.
    kwargs: dict = {
        "model": model,
        "messages": messages,
        "stream": True,
        "num_retries": 3,
        **provider_kwargs(model),
    }
    if tools:
        kwargs["tools"] = tools

    tc_acc: dict = {}
    stream = await litellm.acompletion(**kwargs)
    async for chunk in stream:
        choices = getattr(chunk, "choices", None)
        if not choices:
            continue
        delta = choices[0].delta

        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning:
            yield Delta(thinking=reasoning)
        if getattr(delta, "content", None):
            yield Delta(text=delta.content)

        for tc in getattr(delta, "tool_calls", None) or []:
            key = tc.index if getattr(tc, "index", None) is not None else tc.id
            slot = tc_acc.setdefault(key, {"id": "", "name": "", "args": ""})
            if getattr(tc, "id", None):
                slot["id"] = tc.id
            fn = getattr(tc, "function", None)
            if fn and getattr(fn, "name", None):
                slot["name"] = fn.name
            if fn and getattr(fn, "arguments", None):
                slot["args"] += fn.arguments

    yield Delta(done=True, tool_calls=[_assemble(slot) for slot in tc_acc.values()])


def _assemble(slot: dict) -> ToolCall:
    try:
        args = json.loads(slot["args"]) if slot["args"].strip() else {}
    except json.JSONDecodeError:
        args = {}
    return ToolCall(id=slot["id"] or slot["name"], name=slot["name"], arguments=args)
