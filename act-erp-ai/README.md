# ACT Persona (ACT ERP-AI)

Internal workforce-management platform for American Completion Tools —
employees, HR, time tracking (web + shop-floor kiosk), leave, requests,
reimbursements, payroll, benefits, and documents — plus an **optional** agentic
RAG assistant that answers from documents the signed-in user is allowed to see,
with a PDF visualizer that highlights cited passages.

The assistant is feature-flagged (`AI_ENABLED`, default **off**) and is not part
of the current production deploy. The core ERP does not depend on it.

## Docs
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — design, decisions, data model, RBAC, infra.
- [`HANDOVER.md`](./HANDOVER.md) — what a deploying engineer needs: accounts, gotchas, ops.
- [`infra/aws/DEPLOY-LITE.md`](./infra/aws/DEPLOY-LITE.md) — **the live deploy** (single box + Docker Compose + Caddy).
- [`infra/aws/LITE-MIGRATION-PLAN.md`](./infra/aws/LITE-MIGRATION-PLAN.md) — why/how the stack was cut down to one box.
- [`infra/aws/DEPLOY.md`](./infra/aws/DEPLOY.md) — the original full ECS Fargate runbook (kept for when the AI feature ships).
- [`LOCAL_RUN.md`](./LOCAL_RUN.md) — run the whole stack locally.
- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — phased build order and what's still deferred.
- [`docs/MICROSOFT-GRAPH-EMAIL.md`](./docs/MICROSOFT-GRAPH-EMAIL.md) — login-code email setup.

## At a glance
- **Monorepo, two services:** `apps/web` (Next.js 16 — UI, auth, RBAC, gateway) and
  `apps/ai` (Python — agent + ingestion worker, one image, only deployed with the flag on).
- **Stack:** Postgres 16 + pgvector, S3, NextAuth v5, Microsoft Graph (login-code
  email), AWS Textract. With the AI feature on: SQS, Amazon Bedrock, Datalab Marker.
  No Redis, no Lambda, no GPU, no LangChain.
- **Schema authority:** Prisma (`apps/web/prisma/schema.prisma`) owns all tables;
  Python reads/writes via raw SQL.
- **Auth:** username **or** email + password, with optional emailed 6-digit 2FA
  (`LOGIN_2FA_ENABLED`); JWT sessions, 8h absolute / 30m rolling, revocable
  instantly via `User.tokenVersion`.
- **RBAC on retrieval:** scope computed in `web`, enforced in SQL `WHERE` **and**
  Postgres RLS — the model can never widen its own scope.
- **Deployment today:** one Lightsail box running `web` + Postgres + Caddy via
  `infra/docker-compose.prod-lite.yml`, shared with ACT Beacon and ACT Prism.
