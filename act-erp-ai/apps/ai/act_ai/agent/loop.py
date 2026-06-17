"""The agent loop. No framework: model call → tool calls → results → repeat,
emitting an SSE event for every transition. The streamer is injected so the loop
is testable with a scripted fake model (no API key). Ported from relearn.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from collections.abc import AsyncIterator, Callable

import asyncpg

from act_ai.agent import events as ev
from act_ai.agent.evidence import RunContext
from act_ai.agent.tools import TOOLS, Tool
from act_ai.agent.tools.base import ToolResult  # noqa: F401  (re-export convenience)
from act_ai.config import get_settings
from act_ai.llm.stream import AssistantTurn, Delta, stream_turn

_EID_RE = re.compile(r"\[E\d+\]")
_UNCITED_MIN_WORDS = 25

Streamer = Callable[..., AsyncIterator[Delta]]


async def default_streamer(messages: list[dict], *, tools: list[dict] | None = None):
    async for delta in stream_turn("agent", messages, tools=tools):
        yield delta


def _clock_ms() -> int:
    return int(time.monotonic() * 1000)


async def run_agent(
    messages: list[dict],
    ctx: RunContext,
    conn: asyncpg.Connection,
    *,
    tools: list[Tool] | None = None,
    streamer: Streamer = default_streamer,
    model_label: str = "agent",
    start_seq: int = 0,
) -> AsyncIterator[ev.Event]:
    tool_list = tools if tools is not None else list(TOOLS.values())
    by_name = {t.name: t for t in tool_list}
    schemas = [t.openai_schema() for t in tool_list]
    seq = start_seq

    def emit(event: ev.Event) -> ev.Event:
        nonlocal seq
        event.seq = seq
        seq += 1
        return event

    yield emit(ev.run_started(uuid.uuid4().hex, model_label))

    final_text = ""
    steps = 0

    for _iteration in range(get_settings().max_agent_steps):
        turn = AssistantTurn(text="", thinking="", tool_calls=[])
        text_buf: list[str] = []

        async for delta in streamer(messages, tools=schemas):
            if delta.thinking:
                yield emit(ev.thinking_delta(delta.thinking))
            if delta.text:
                text_buf.append(delta.text)
                yield emit(ev.text_delta(delta.text))
            if delta.done:
                turn = AssistantTurn("".join(text_buf), delta.thinking, delta.tool_calls)

        if not turn.tool_calls:
            final_text = turn.text
            break

        messages.append(_assistant_message(turn))

        for call in turn.tool_calls:
            steps += 1
            tool = by_name.get(call.name)
            if tool is None:
                messages.append(_tool_message(call.id, {"error": f"unknown tool {call.name}"}))
                yield emit(ev.tool_result(call.id, call.name, "Unknown tool", 0))
                continue
            try:
                args = tool.Args.model_validate(call.arguments)
            except Exception as exc:  # noqa: BLE001
                messages.append(_tool_message(call.id, {"error": f"invalid arguments: {exc}"}))
                yield emit(ev.tool_started(call.id, call.name, f"{call.name} (invalid args)"))
                yield emit(ev.tool_result(call.id, call.name, "Invalid arguments", 0))
                continue

            yield emit(ev.tool_started(call.id, call.name, tool.label(args), call.arguments))

            if tool.requires_user:
                # Minimal HITL: emit the clarification and stop (resume is a follow-up).
                yield emit(ev.clarification_required(call.id, getattr(args, "question", ""),
                                                     getattr(args, "options", None)))
                return

            t0 = _clock_ms()
            try:
                result = await tool.run(args, ctx, conn)
            except Exception as exc:  # tool failure is model-visible, never a crash
                messages.append(_tool_message(call.id, {"error": f"tool failed: {exc}"}))
                yield emit(ev.tool_result(call.id, call.name, f"Failed: {exc}", _clock_ms() - t0))
                continue

            for eid in result.new_evidence:
                item = ctx.registry.get(eid)
                if item:
                    yield emit(ev.evidence_added({"eid": eid, **item.to_payload()}))
            messages.append(_tool_message(call.id, result.payload))
            yield emit(ev.tool_result(call.id, call.name, result.summary, _clock_ms() - t0))
    else:
        final_text = final_text or "I've reached my step limit. Here's what I found so far."

    cmap, flags = _verify_citations(final_text, ctx)
    yield emit(ev.citation_map(cmap))
    level, reason = _confidence(ctx, flags)
    yield emit(ev.confidence(level, reason))
    yield emit(ev.run_completed({}, 0, steps))


def _assistant_message(turn: AssistantTurn) -> dict:
    msg: dict = {"role": "assistant", "content": turn.text or None}
    if turn.tool_calls:
        msg["tool_calls"] = [
            {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.raw_arguments}}
            for c in turn.tool_calls
        ]
    return msg


def _tool_message(call_id: str, payload: dict) -> dict:
    return {"role": "tool", "tool_call_id": call_id, "content": json.dumps(payload)}


def _verify_citations(text: str, ctx: RunContext) -> tuple[dict, dict]:
    cited = set(re.findall(r"\[E(\d+)\]", text))
    cmap = ctx.registry.citation_map()
    flags: dict = {}
    for n in cited:
        if f"E{n}" not in cmap:
            flags["has_dangling"] = True
    uncited = 0
    for para in (p.strip() for p in text.split("\n\n")):
        if len(para.split()) >= _UNCITED_MIN_WORDS and not _EID_RE.search(para):
            uncited += 1
    if uncited:
        flags["uncited_paragraphs"] = uncited
    used = {f"E{n}" for n in cited}
    for eid, payload in cmap.items():
        payload["used"] = eid in used
    return cmap, flags


def _confidence(ctx: RunContext, flags: dict) -> tuple[str, str]:
    n = len(ctx.registry.all())
    if n == 0:
        return "low", "no evidence was retrieved"
    if flags.get("has_dangling"):
        return "low", "the answer cited evidence ids that don't resolve"
    if flags.get("uncited_paragraphs"):
        return "medium", "some claims aren't backed by a citation"
    if n >= 3:
        return "high", f"grounded in {n} evidence passages"
    return "medium", f"grounded in {n} evidence passage(s)"
