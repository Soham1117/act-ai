"""Tool registry. Every corpus tool receives a RunContext and is scope-enforced
(SQL WHERE + RLS). No raw SQL is exposed to the model."""

from act_ai.agent.tools.base import Tool, ToolResult
from act_ai.agent.tools.retrieval_tools import (
    ExpandChunk,
    GetImages,
    GetToc,
    QueryRecords,
    ReadSection,
    SearchChunks,
)

TOOLS: dict[str, Tool] = {
    t.name: t
    for t in (SearchChunks(), GetToc(), ReadSection(), ExpandChunk(), GetImages(), QueryRecords())
}

__all__ = ["TOOLS", "Tool", "ToolResult"]
