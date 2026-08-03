"""Tool framework. Each tool has a Pydantic args model (JSON schema auto-generated
for the LLM), a deterministic label() shown while running, and run(). Corpus tools
get the RunContext server-side; scope is enforced in SQL + RLS, never trusted to
the model."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar

import asyncpg
from pydantic import BaseModel

from act_ai.agent.evidence import RunContext


@dataclass
class ToolResult:
    payload: dict  # full result fed back to the model
    summary: str  # deterministic one-liner for the tool_result SSE event
    new_evidence: list[str] = field(default_factory=list)


class Tool:
    name: ClassVar[str]
    description: ClassVar[str]
    Args: ClassVar[type[BaseModel]]
    requires_user: ClassVar[bool] = False

    def label(self, args: BaseModel) -> str:  # noqa: ARG002
        return f"Running {self.name}…"

    async def run(self, args: BaseModel, ctx: RunContext, conn: asyncpg.Connection) -> ToolResult:
        raise NotImplementedError

    def openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.Args.model_json_schema(),
            },
        }
