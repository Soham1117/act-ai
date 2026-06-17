# ACT ERP-AI

Agentic RAG built into the ACT ERP. Authenticated users chat with an agent that
retrieves **only from documents they're allowed to see** — over unstructured text
(vector + full-text) and structured records (scoped SQL) — with a PDF visualizer
that highlights cited passages.

## Docs
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — design, decisions, data model, RBAC, infra.
- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — phased build order.

## At a glance
- **Monorepo, two services:** `apps/web` (Next.js — UI, auth, RBAC, gateway) and
  `apps/ai` (Python — agent + ingestion worker, one image).
- **Stack:** Postgres+pgvector (RDS), S3, SQS, ECS Fargate ×3, Amazon Bedrock,
  Datalab Marker. NextAuth v5. No Redis, no Lambda, no GPU, no LangChain.
- **Schema authority:** Prisma owns all tables; Python reads/writes via raw SQL.
- **RBAC on retrieval:** scope computed in `web`, enforced in SQL `WHERE` **and**
  Postgres RLS — the model can never widen its own scope.

> `relearn` (sibling folder) is **reference only** — specific files are ported in,
> the folder is not copied.
