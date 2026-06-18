# Local walkthrough (Gemini, no AWS)

Run the whole stack locally and chat with real answers using your Gemini key.
LLM + embeddings go through LiteLLM → Gemini (config in `apps/ai/llm/models.yaml`);
storage/queue use LocalStack. Swap to Bedrock at deploy time by editing models.yaml.

## 0. Prerequisites (already running in this dev box)
- **Postgres** with the `act` database (in the `relearn-postgres-1` pgvector container).
- **LocalStack** (S3 + SQS) on `:4566` (container `act-localstack`).

If LocalStack was restarted, recreate the bucket + queue:
```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --endpoint-url=http://localhost:4566 --region us-east-2 s3 mb s3://act-erp-ai-docs
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --endpoint-url=http://localhost:4566 --region us-east-2 sqs create-queue --queue-name act-ingestion
```

If you ran `prisma db push` since, **re-apply** the raw SQL (it re-adds tsv/HNSW/RLS):
```bash
docker cp apps/web/prisma/sql/01_rag_pgvector_rls.sql relearn-postgres-1:/tmp/rls.sql
docker exec relearn-postgres-1 psql -U relearn -d act -f /tmp/rls.sql
```

## 1. Set your Gemini key
Edit `apps/ai/.env` → `GEMINI_API_KEY=...` (get one at aistudio.google.com).
`EMBED_FAKE` is already `false` so embeddings use Gemini (1024-d).

## 2. Start the AI service + worker (two terminals)
```bash
cd apps/ai
uv pip install -e .            # first time (or use the existing .venv)
set -a; . ./.env; set +a       # export env for litellm/boto3

uvicorn act_ai.main:app --port 8001 --reload      # terminal A: agent
python -m act_ai.worker                            # terminal B: ingestion worker
```

## 3. Start the web app (terminal C)
```bash
cd apps/web
pnpm install
pnpm dev                       # http://localhost:3000
```
`apps/web/.env.local` is already pointed at the local `act` DB, LocalStack, and the
agent (`AGENT_SERVICE_URL=http://localhost:8001`, token `dev-insecure-change-me`
matching the AI service default).

## 4. Create an admin (one time)
```bash
cd apps/web
pnpm tsx --env-file=.env.local scripts/create-admin.ts you@actools.com 'StrongPass#1' 'Your Name'
```

## 5. Walk through it
1. Log in at `/login`.
2. **Admin → Knowledge base** (`/admin/knowledge`) → **Upload document**.
   Use a **CSV or XLSX** (BOM / tool records) — these ingest with no extra keys.
   (PDF/DOCX need `DATALAB_API_KEY` in `apps/ai/.env`; without it those fail.)
3. Wait for status **READY** (the worker logs progress).
4. **Assistant** (`/admin/chat`): pick the doc (or leave all) and ask a question.
   You'll see streamed answer + tool activity + `[E#]` citations.
5. Click a citation chip → the evidence panel opens (PDF highlight for PDFs; rows
   show inline). A second user only sees documents granted to them.

## Notes
- **RBAC is real**: the agent only ever sees documents the logged-in user can access
  (computed in `/api/chat`, enforced by SQL + Postgres RLS).
- **PDF highlights** need `pageDimensions` from Marker ingestion; CSV/XLSX answers
  cite rows (no page view). PDF page-render works; bbox overlay populates once the
  Marker path runs with a Datalab key.
