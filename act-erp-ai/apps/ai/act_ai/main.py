"""FastAPI entrypoint for the agent service (Fargate `agent` container).

Only reachable from `web` (internal, service-token auth). The browser never calls
this directly. Phase 0: health + a /chat stub that streams SSE. The real agent
loop lands in Phase 6.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from act_ai.config import get_settings
from act_ai.db import close_pool, init_pool


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_pool()
    yield
    await close_pool()


app = FastAPI(title="act-ai agent service", lifespan=lifespan)


def require_service_token(authorization: str | None = Header(default=None)) -> None:
    expected = f"Bearer {get_settings().internal_service_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="invalid service token")


class ChatRequest(BaseModel):
    user_id: str
    allowed_doc_ids: list[str]
    selected_doc_ids: list[str] | None = None
    messages: list[dict]


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "act-ai"}


@app.post("/chat", dependencies=[Depends(require_service_token)])
async def chat(req: ChatRequest) -> EventSourceResponse:
    """SSE stream. Phase 0 stub — emits a placeholder run so the web gateway and
    frontend reducer can be wired end-to-end before the agent loop exists."""

    async def event_stream() -> AsyncIterator[dict]:
        yield {"event": "run_started", "data": "{}"}
        yield {
            "event": "text_delta",
            "data": '{"text": "agent service reachable; loop not yet implemented (Phase 6)."}',
        }
        yield {"event": "run_completed", "data": '{"steps": 0}'}

    return EventSourceResponse(event_stream())
