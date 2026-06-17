"""SSE event taxonomy. The agent loop emits an event for every state transition;
each carries a monotonic seq for reconnect-replay. Ported from relearn."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Event:
    type: str
    data: dict[str, Any] = field(default_factory=dict)
    seq: int = 0

    def sse(self) -> dict[str, Any]:
        # data MUST be a JSON string (sse-starlette repr()s non-strings).
        return {"event": self.type, "data": json.dumps({**self.data, "seq": self.seq})}


def run_started(run_id: str, model: str) -> Event:
    return Event("run_started", {"run_id": run_id, "model": model})


def thinking_delta(text: str) -> Event:
    return Event("thinking_delta", {"text": text})


def text_delta(text: str) -> Event:
    return Event("text_delta", {"text": text})


def tool_started(call_id: str, tool: str, label: str, args_summary: dict | None = None) -> Event:
    return Event("tool_started", {"call_id": call_id, "tool": tool, "label": label, "args_summary": args_summary or {}})


def tool_result(call_id: str, tool: str, summary: str, duration_ms: int) -> Event:
    return Event("tool_result", {"call_id": call_id, "tool": tool, "summary": summary, "duration_ms": duration_ms})


def evidence_added(item: dict) -> Event:
    return Event("evidence_added", item)


def clarification_required(call_id: str, question: str, options: list[str] | None = None) -> Event:
    return Event("clarification_required", {"call_id": call_id, "question": question, "options": options or []})


def citation_map(mapping: dict) -> Event:
    return Event("citation_map", {"map": mapping})


def confidence(level: str, reason: str) -> Event:
    return Event("confidence", {"level": level, "reason": reason})


def run_completed(usage: dict, duration_ms: int, steps: int) -> Event:
    return Event("run_completed", {"usage": usage, "duration_ms": duration_ms, "steps": steps})


def error(message: str, recoverable: bool = True) -> Event:
    return Event("error", {"message": message, "recoverable": recoverable})
