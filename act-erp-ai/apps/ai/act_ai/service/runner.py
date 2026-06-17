"""Run the agent loop for a chat turn and persist its event stream.

The AI service trusts the web gateway (internal token) and never validates end
users. Scope arrives pre-computed as allowed_doc_ids (web RBAC); the runner
intersects it with the user's picker selection and enforces it as the agent's
corpus. Tool reads run under the RLS role (scoped_conn); run/event writes run as
the owner (owner_conn) since the RLS role is read-only.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from act_ai.agent import events as ev
from act_ai.agent.evidence import EvidenceRegistry, RunContext
from act_ai.agent.loop import Streamer, default_streamer, run_agent
from act_ai.agent.prompt import build_system_prompt
from act_ai.db import new_id, owner_conn, scoped_conn


async def run_chat_turn(
    *,
    user_id: str,
    allowed_doc_ids: list[str],
    selected_doc_ids: list[str] | None,
    messages: list[dict],
    streamer: Streamer = default_streamer,
) -> AsyncIterator[ev.Event]:
    allowed = set(allowed_doc_ids)
    effective = [d for d in (selected_doc_ids or allowed_doc_ids) if d in allowed]

    run_id = new_id()
    async with owner_conn() as w:
        await w.execute(
            'INSERT INTO "AgentRun" (id,"userId",status,"scopeDocIds","createdAt","updatedAt") '
            "VALUES ($1,$2,'running',$3,now(),now())",
            run_id, user_id, json.dumps(effective),
        )

        ctx = RunContext(user_id=user_id, allowed_doc_ids=effective, registry=EvidenceRegistry())
        try:
            async with scoped_conn(effective) as r:
                titles = await r.fetch(
                    'SELECT id, title FROM "KnowledgeDocument" WHERE id = ANY($1::text[])', effective
                )
                slug_by_id = {d: f"doc-{i}" for i, d in enumerate(effective)}
                docs = [{"slug": slug_by_id[t["id"]], "title": t["title"]} for t in titles]
                convo = [{"role": "system", "content": build_system_prompt(docs)}, *messages]

                async for event in run_agent(convo, ctx, r, streamer=streamer):
                    await _persist_event(w, run_id, event)
                    yield event

            await w.execute('UPDATE "AgentRun" SET status=\'completed\', "updatedAt"=now() WHERE id=$1', run_id)
        except Exception as exc:  # surface as an error event + mark failed
            await w.execute('UPDATE "AgentRun" SET status=\'failed\', "updatedAt"=now() WHERE id=$1', run_id)
            yield ev.error(str(exc))
            raise


async def _persist_event(w, run_id: str, event: ev.Event) -> None:
    await w.execute(
        'INSERT INTO "AgentRunEvent" (id,"runId",seq,type,"dataJson","createdAt") VALUES ($1,$2,$3,$4,$5,now())',
        new_id(), run_id, event.seq, event.type, json.dumps({**event.data, "seq": event.seq}),
    )
    if event.type == "evidence_added":
        await w.execute(
            'INSERT INTO "EvidenceLog" (id,"runId",eid,"sourceKind","sourceId","createdAt") VALUES ($1,$2,$3,$4,$5,now())',
            new_id(), run_id, event.data.get("eid"), event.data.get("source_kind"), event.data.get("source_id"),
        )
