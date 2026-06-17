# act-ai

Python service: the agent runtime (FastAPI) and the ingestion worker. One image,
two entrypoints.

## Layout
```
act_ai/
  config.py        # settings (env-driven; us-east-2 / Bedrock defaults)
  db.py            # asyncpg pool + scoped_conn() (RLS: app.allowed_docs)
  main.py          # FastAPI agent service (uvicorn act_ai.main:app)
  worker.py        # SQS ingestion consumer (python -m act_ai.worker)
  llm/
    gateway.py     # litellm -> Bedrock (embed / acompletion)
    models.yaml    # role -> model map (swap models without code changes)
  agent/           # loop, tools, retrieval, SSE  (Phase 5-6)
  ingestion/       # Marker + pandas/openpyxl pipeline (Phase 4)
```

## Local dev
```bash
cp .env.example .env
uv pip install -e ".[dev]"
uvicorn act_ai.main:app --reload --port 8001   # agent
python -m act_ai.worker                         # worker (separate shell)
pytest
```
Or via the stack: `docker compose -f ../../infra/docker-compose.yml up`.

## Notes
- The schema is owned by `apps/web` (Prisma). This service uses raw SQL only.
- Bedrock auth is the task IAM role in prod; locally litellm reads AWS_* env vars.
- RBAC: every query runs through `scoped_conn(allowed_doc_ids)` (RLS) **and**
  app-layer WHERE filters. Never bypass it. See `../../ARCHITECTURE.md` §6.
