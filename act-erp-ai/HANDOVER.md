# ACT ERP-AI — Engineering Handover

Everything a deploying engineer needs to take this from the repo to production.
Written 2026-08-03. Owner of record until now: Asim Siddiqui (intern project).

## What this is

An ERP for American Completion Tools (HR/time-tracking/payroll/etc.) with an
integrated **agentic RAG assistant**: users upload PDFs (BOMs, tool manuals,
spec sheets, inspection reports), the system parses them with Marker, indexes
them with hybrid search (pgvector + Postgres full-text), and an agent answers
questions with **clickable citations** that open the exact highlighted passage
in a PDF viewer. Retrieval is permission-scoped per user, enforced in SQL *and*
Postgres row-level security.

Read these, in order:
1. [`README.md`](./README.md) — 2-minute overview
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — design, data model, RBAC, decisions
3. [`infra/aws/DEPLOY.md`](./infra/aws/DEPLOY.md) — **the deployment runbook** (step-by-step AWS CLI)
4. [`LOCAL_RUN.md`](./LOCAL_RUN.md) — run everything locally first
5. [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — what's built, what's deferred

## Repo layout

```
apps/web   Next.js 16 — UI, NextAuth v5 auth, RBAC, chat gateway (/api/chat), Prisma (owns ALL tables)
apps/ai    Python 3.12 — FastAPI agent service (:8001) + SQS ingestion worker (same image, two commands)
infra/     Dockerfiles, docker-compose (local), aws/ (runbook + IAM policies + ECS task defs)
data/      56 synthetic ACT PDFs used for testing (not for prod)
.github/   deploy.yml — CI: build/push images to ECR + roll ECS services on merge
```

## Accounts & credentials the engineer must obtain

| Thing | Why | Where |
|---|---|---|
| AWS account (us-east-2) | Everything runs on ECS Fargate + RDS + S3 + SQS + Bedrock | company AWS org |
| **Bedrock model access** | Prod LLM (Llama 3.3 70B) + embeddings (Titan v2) | AWS console → Bedrock → Model access → enable both, in us-east-2 |
| **Datalab API key** | Marker PDF parsing (the ingestion worker calls datalab.to) | https://www.datalab.to — paid per page; parses are cached in S3 by file checksum so each unique file is paid once |
| GitHub repo access + Actions secrets | CI deploys | this repo → Settings → Secrets (AWS creds for the deploy role) |
| (optional) domain + ACM cert | HTTPS on the ALB | Route53/ACM — runbook ships HTTP-only listener |

**Not needed in prod:** the Gemini key (dev-only; prod uses Bedrock), LocalStack,
the demo seed data. Never reuse dev keys — the project has already had one
Gemini key revoked by Google after it leaked. **No secret ever goes in the repo;**
prod secrets live in AWS Secrets Manager (the runbook creates them).

## How to deploy (summary — the runbook has exact commands)

`infra/aws/DEPLOY.md` is a top-to-bottom AWS CLI runbook. Rough shape:

1. Default VPC + 3 security groups (ALB → web :3000, svc↔svc :8001, svc → RDS :5432)
2. ECR ×2, build & push the two Docker images (`infra/Dockerfile.web`, `infra/Dockerfile.ai`)
3. S3 bucket (private, public-access-blocked) + SQS queue (**VisibilityTimeout 900** — Marker parses take minutes) + DLQ
4. RDS Postgres 16 with **pgvector**
5. Secrets Manager entries (DB URLs, AUTH_SECRET, INTERNAL_SERVICE_TOKEN, DATALAB_API_KEY)
6. IAM: execution role (pull images, read secrets) + task role (S3, SQS, Bedrock) — JSONs in `infra/aws/iam/`
7. ECS cluster + Cloud Map namespace (web reaches the agent at `agent.act.local:8001` — the agent is **never** internet-exposed)
8. ALB → web service; register the 3 Fargate services from `infra/aws/ecs/*.json` (envsubst placeholders)
9. **Database migrate — read the critical note below**
10. Create the first admin, smoke-test

CI (`.github/workflows/deploy.yml`) rebuilds changed images and rolls services on
push to main — set the AWS credentials secrets in GitHub first.

### ⚠️ Critical: the database migration two-step

Prisma owns the schema, but three things live **outside** Prisma in raw SQL:
the generated `tsv` full-text column + GIN index, the two HNSW vector indexes,
and the row-level-security role/policies. **`prisma db push` silently drops all
of them.** The rule, forever:

```bash
prisma db push            # (or migrate deploy)
psql < apps/web/prisma/sql/01_rag_pgvector_rls.sql   # ALWAYS re-apply after
```

If search quality suddenly dies or RLS tests fail after a schema change, this is
why. Verify with: `\d "Chunk"` (tsv present), `\di` (2 hnsw indexes),
`select count(*) from pg_policies` (6).

### Embeddings: pick one mode and re-ingest if you ever switch

Chunk/query vectors **must come from the same model** (1024-dim column).

- **Prod (recommended):** Bedrock Titan v2 — set env `EMBED_MODEL=bedrock/amazon.titan-embed-text-v2:0`
  and `EMBED_LOCAL=false`. No model download, IAM-authed, no API keys.
- **Dev:** `EMBED_LOCAL=true` runs mxbai-embed-large-v1 locally (free, no rate
  limits; ~640 MB download on first run).

Switching modes later = re-ingest every document (`scripts/requeue-failed.ts`
after marking docs FAILED). A fresh prod DB starts empty, so just pick Titan and
ingest once.

The chat LLM is env-driven the same way: `AGENT_MODEL=bedrock/us.meta.llama3-3-70b-instruct-v1:0`
in prod (task defs already set both); local dev falls back to `apps/ai/act_ai/llm/models.yaml` (Gemini).

## Operational notes

- **Ingestion flow:** upload (web) → sha256 dedup → S3 `knowledge/` → SQS →
  worker → Datalab Marker (cached in S3 `parses/{sha}.json`) → normalize/map →
  chunks with page+bbox+polygon → embeddings → READY. Failures set
  `status=FAILED` + reason; `apps/web/scripts/requeue-failed.ts` re-enqueues
  (cache makes retries cheap). Worker processes 5 jobs concurrently.
- **PDF viewing** is proxied through the app (`/api/knowledge/[id]/file`) — no
  S3 CORS config needed, and every read re-checks the user's access. Don't
  "optimize" this back to signed URLs without adding bucket CORS.
- **Security model:** browser → web only. Web computes the user's allowed
  document set and passes it to the agent service with a shared bearer token
  (`INTERNAL_SERVICE_TOKEN` — generate a strong one). Tool SQL runs as the
  `act_rls` role so even a prompt-injected model cannot widen scope.
  NextAuth v5 credentials + JWT; `tokenVersion` bump = instant revocation.
- **Chat history** persists in `ChatSession`/`ChatMessage` (per-user, ownership
  checked server-side; citations stored as JSON so [E#] chips survive reload).
- **Costs to watch:** Datalab per parsed page (cache prevents re-pays), Bedrock
  tokens (no budget guardrails yet — Phase 9), RDS/Fargate baseline.

## Local development

`LOCAL_RUN.md`. Postgres+pgvector and LocalStack (S3/SQS) in Docker; the three
services run natively. Gotchas learned the hard way:
- LocalStack state is **in-memory** — bucket/queue vanish on restart (recreate,
  or restore from a backup; see LOCAL_RUN).
- If a Homebrew Postgres is running it shadows Docker's :5432 (`brew services
  stop postgresql@17`).
- `pnpm tsx --env-file=.env.local scripts/create-admin.ts` bootstraps an admin.
- `scripts/seed-30-days.ts` / `seed-topup.ts` generate demo ERP data;
  `scripts/upload-knowledge.ts <dir>` bulk-ingests documents. **None of these
  run in prod.**

## Known gaps (deliberate, documented in IMPLEMENTATION_PLAN.md)

- Per-user/department **grant-picker UI** (server action `setDocumentGrants`
  exists; admins currently upload ORG-visible or grant via action)
- `ask_user` human-in-the-loop **resume** (agent asks a clarifying question and
  stops; a follow-up message continues naturally)
- Phase 9 hardening: retrieval eval set, scope-leak regression tests in CI,
  observability (CloudWatch dashboards/Langfuse), Bedrock token budgets/alarms,
  RDS snapshot policy, S3 lifecycle for the parse cache
- No IaC yet — intentional; the runbook maps 1:1 to resources. Revisit
  Terraform/CDK when there's more than one environment (note at the end of
  IMPLEMENTATION_PLAN.md).
- DOCX ingests via the same Marker path; CSV/XLSX go to structured record
  tables (`query_records` tool). PDF is the primary, battle-tested path.
