# ACT ERP-AI — Implementation Plan

Build order for the architecture in `ARCHITECTURE.md`. Phases are sequenced so each
ends with something runnable/verifiable. Ship locally (docker-compose + LocalStack)
through Phase 7; deploy to AWS in Phase 8.

**Golden rule:** RBAC scope is enforced server-side from day one. Never add a
retrieval path that isn't scoped — not even "temporarily for testing."

---

## Phase 0 — Repo scaffold & migration

**Goal:** `act-erp-ai/` exists as a clean monorepo; current erp runs from `apps/web`.

- [x] Create `act-erp-ai/` with `apps/`, `infra/`, `.github/workflows/`.
- [x] Move `erp/` → `apps/web/` (node_modules + .env.local intact, `next` binary present).
- [x] Create `apps/ai/` skeleton (FastAPI `main.py` + SSE stub, `worker.py` SQS loop,
      `config.py`, `db.py` w/ RLS `scoped_conn`, `llm/gateway.py` + `models.yaml`, tests).
- [x] `infra/docker-compose.yml`: postgres(pgvector), web, ai-agent, ai-worker, localstack.
- [x] `Dockerfile.web`, `Dockerfile.ai` (one ai image; agent vs worker = different CMD).
- [x] `infra/localstack/init-aws.sh` (creates S3 bucket + SQS queue locally).
- [ ] Port from `relearn` — deferred into the phases that use them (agent/retrieval in
      P5–P6, frontend visualizer/chat in P7). Not a P0 blocker.
- [ ] First git commit / push — pending (do when ready to push to GitHub).

**Exit:** structure in place; Python compiles; web intact. Full `docker compose up`
boot deferred until Phase 1 provides the schema.

---

## Phase 1 — Database & schema authority (Prisma)

**Goal:** one Postgres, Prisma owns all tables, pgvector live.

- [x] Standardize embeddings to **1024 dims** (all three stub columns → vector(1024)).
- [x] Add AI tables to `schema.prisma`: KnowledgeDocument, DocumentGrant,
      StructureNode, Chunk, DocImage, RecordTable, RecordRow, AgentRun,
      AgentRunEvent, EvidenceLog (+ enums FileKind, DocVisibility, IngestStatus).
      `prisma validate` passes; `db push` creates all tables.
- [x] Raw-SQL migration `prisma/sql/01_rag_pgvector_rls.sql`: vector extension,
      generated `tsv` column + GIN, HNSW indexes on Chunk.embedding & RecordRow.rowEmbedding.
- [x] Read-mostly RLS role `act_rls`; RLS enabled (not forced, so owner/worker
      bypasses for ingestion) + SELECT policies via `current_setting('app.allowed_docs')`.
- [x] **Verified against real Postgres:** scope=docA→2, docB→1, empty→0 (fail-closed),
      owner→3. HNSW + tsv indexes confirmed present.
- [ ] Repoint web `DATABASE_URL` off Supabase → Postgres (folded into P2/P3 env work;
      dev DB `act` already created in local pgvector instance).
- [ ] Python raw-SQL accessors per table — built where needed in P4 (ingestion writes)
      and P5 (scoped reads). `db.py` `scoped_conn()` primitive done.

**Exit:** ✅ schema valid, tables created, RLS proven to block out-of-scope rows.

---

## Phase 2 — Auth hardening (NextAuth v5)

**Goal:** replace Supabase Auth; sessions are short-lived and revocable.

- [x] Install NextAuth v5 (`next-auth@beta`) + bcryptjs. No adapter (credentials → JWT).
- [x] **JWT strategy + `User.tokenVersion`** for instant revocation (DB sessions
      aren't supported with credentials); rolling 30m / 8h absolute.
- [x] Split config: `auth.config.ts` (edge-safe) + `auth.ts` (Node, Credentials).
      Rewired `getSessionUser` (role + tokenVersion from DB), `requireUser/Admin`,
      `proxy.ts` (optimistic), `[...nextauth]/route.ts`, login action + form, signOut.
- [x] Credentials sign-in (email+password, bcrypt cost 12). `scripts/create-admin.ts`.
      `revokeUserSessions()` helper for logout-everywhere.
- [x] Repointed dev DB off Supabase → local `act`; added `AUTH_SECRET`.
- [x] **Verified:** typecheck clean; admin created; correct password verifies,
      wrong password rejected; role/tokenVersion correct.
- [ ] MFA for ADMIN — deferred. Password reset/forgot + Supabase OAuth callback
      routes still present (non-functional for credentials) — cleaned up in P3.
- [ ] No user migration needed (no real data yet).

**Exit:** ✅ credentials auth implemented & verified; revocation via tokenVersion;
8h/30m lifetimes.

---

## Phase 3 — Storage & upload → S3 + SQS

**Goal:** documents land in S3 and enqueue an ingestion job.

- [x] `lib/storage.ts` rewritten on S3 (single bucket + logical-prefix; private
      objects; signed-URL reads). `lib/aws.ts` shared S3/SQS clients (LocalStack
      endpoint locally, task IAM role in prod). `lib/queue.ts` `enqueueIngestion`.
- [x] `uploadKnowledgeDocument` action: sha256 dedup → S3 → KnowledgeDocument row
      (`status=QUEUED`) → grants/visibility → audit → SQS enqueue. `setDocumentGrants`.
- [x] `lib/knowledge/access.ts`: `allowedDocumentIds` / `listAccessibleDocuments`
      (the authoritative scope reused by the agent gateway in P6).
- [x] Audit extended to `knowledge.upload` / `upload_dedup` / `set_grants`.
- [x] **Verified on LocalStack:** S3 put→sign→download round-trips; SQS
      enqueue→receive works; typecheck clean.
- [ ] Grant management UI + upload UI — lands with the chat document picker (P7).
- [ ] Migrate remaining Supabase usage (employee/onboarding auth-user creation,
      realtime notifications, password reset) — post-Phase-3 follow-up.

**Exit:** ✅ storage on S3; knowledge upload creates row + SQS job; scope helper
resolves grants per user.

---

## Phase 3b — Complete Supabase removal (follow-up)

**Goal:** no runtime dependency on Supabase. Non-blocking for P4–P7 but **must
land before Phase 8 deploy** (prod should be Supabase-free, single AWS bill).
Storage is already migrated; this covers the rest.

- [x] **Auth-user creation** — `employees.ts` (`createEmployee`, `changeEmployeePassword`,
      `bulkDeleteEmployees`) + `onboarding.ts` now create a `User` + `passwordHash`
      (no Supabase). Delete disables login (null hash + bump tokenVersion), preserving
      provenance. Password change/reset revokes sessions.
- [x] **Realtime notifications** — `notifications-realtime.tsx` polls
      `/api/notifications/unread` every 30s (replaced Supabase Realtime).
- [x] **Password reset/change** — self-service `changeMyPassword` (verifies current,
      revokes sessions); `forgot-password` is now a "contact your admin" page; removed
      `auth/reset-password` + `auth/callback` (Supabase OAuth).
- [x] Deleted `lib/supabase/*`, dropped `@supabase/*` deps, removed all Supabase env
      from `env.ts`/`.env.example`/`next.config`. Removed legacy Supabase seed scripts
      (`create-admin.ts` remains for the first admin).
- [x] **Verified:** `git grep supabase` clean in code (only historical comments);
      `next build` green.

**Exit:** ✅ runtime is Supabase-free (AWS + NextAuth only); build green.

---

## Phase 4 — Ingestion worker (multi-format)

**Goal:** queued docs become retrievable (chunks/embeddings + structured rows).

- [x] SQS consumer loop in `worker.py` → `ingest_document(doc_id)`; owner DB pool
      (RLS-bypassing) for writes; `new_id()` for cuid-less raw inserts.
- [x] **PDF/DOCX path:** `datalab.py` (submit/poll Marker) + S3 parse cache by
      checksum → `marker_normalize.py` → StructureNode + Chunk + RecordTable/Row +
      DocImage. (LibreOffice DOCX→PDF fallback available in the image.)
- [x] **CSV/XLSX path:** `structured.py` (pandas/openpyxl) → RecordTable/RecordRow
      directly, with per-row text serialized for embedding.
- [x] Common tail (`pipeline.py`): batch embeddings (Bedrock via gateway, or
      deterministic **fake fallback** for dev) → transactional commit (idempotent
      delete-then-insert) → `status=READY`; failures → `FAILED` + reason.
- [x] Dedup handled at upload (P3 checksum) + idempotent re-ingest.
- [x] **Verified:** CSV end-to-end (S3 download → 1 table/3 rows → embedded →
      READY) against real Postgres + LocalStack; 3 unit tests pass (structured +
      marker normalize).
- [ ] PDF/DOCX live run needs `DATALAB_API_KEY` + Bedrock — normalizer may need
      tuning against real Marker JSON (isolated in `marker_normalize.py`).

**Exit:** ✅ CSV/XLSX reach READY with rows+embeddings; PDF/DOCX path implemented
and unit-tested (live-pending credentials).

---

## Phase 5 — LLM gateway + retrieval

**Goal:** scoped hybrid retrieval and structured queries work against Bedrock.

- [x] LiteLLM gateway + `models.yaml` (Bedrock embed + acompletion); embeddings via
      `ingestion/embed.py` with deterministic fake fallback for local runs.
- [x] `agent/retrieval.py`: `search_chunks` internals — pgvector HNSW + FTS (tsv) +
      RRF fusion + heading boost, scoped (asyncpg, our schema).
- [x] `agent/tools/`: `search_chunks`, `get_toc`, `read_section`, `expand_chunk`,
      `get_images`, and `query_records` (typed/parameterized: `contains` JSON-match
      + semantic over `rowEmbedding`; **no raw SQL from the model**). `RunContext` +
      `EvidenceRegistry` (chunk + row evidence) ported.
- [x] **Verified under the `act_rls` role:** docA-scoped user gets only docA passages
      (no cross-doc leak); `query_records` for an out-of-scope record returns 0.
- [x] **Gotcha recorded:** `prisma db push` drops the raw-SQL `tsv`/HNSW/RLS objects
      (not in the Prisma schema) — re-apply `prisma/sql/01_rag_pgvector_rls.sql` after
      every push (added to the run steps below).

**Exit:** ✅ each tool returns only in-scope data; hybrid search produces hits.

---

## Phase 6 — Agent loop + SSE

**Goal:** end-to-end agent run with provenance and streaming.

- [x] `agent/loop.py` ported (asyncpg, our tools/RunContext); injectable streamer.
- [x] `llm/stream.py`: litellm→Bedrock streaming, normalized to `Delta` + tool-call
      assembly. `agent/prompt.py` (ACT invariants + structured-vs-prose guidance).
- [x] Full SSE taxonomy (`agent/events.py`); `service/runner.py` persists `AgentRun`
      + `AgentRunEvent` (seq replay) via owner conn; tool reads via `scoped_conn` (RLS).
- [x] Evidence supports `chunk` + `row`; `EvidenceLog` written per evidence_added.
- [x] Citation verification (dangling/uncited) + confidence scoring.
- [x] `main.py` `/chat` (service-token) → runner SSE. `web` `/api/chat` route:
      auth → `allowedDocumentIds` → proxy SSE (browser never reaches the agent).
- [x] **Verified** with a scripted fake model: event order correct, real tool run
      under scope, `[E1]` resolved+used, confidence computed, persisted (1 run / 8
      events / 1 evidence-log). Web typecheck clean.
- [ ] `ask_user` full HITL **resume** — minimal suspend emits clarification + stops;
      resume is a follow-up (needs registry snapshot/restore).

**Exit:** ✅ agent streams events, cites real evidence, scope-enforced; gateway wired.

---

## Phase 7 — Chat frontend & visualizer

**Goal:** the Chat feature inside the existing erp UI.

- [x] "Assistant" nav in both sidebars; `/dashboard/chat` + `/admin/chat` → shared
      `<ChatWorkspace>` (picker | chat+activity | evidence/visualizer).
- [x] Ported chat reducer/types/SSE client + `useAgentChat` (stateless, resends
      history); wired to `/api/chat`.
- [x] `DocumentVisualizer` + `PdfPage` (pdf.js, windowed, bbox/polygon highlight,
      jump-by-nonce); `lib/pdf.ts` + worker copy script (postinstall). `EvidencePanel`
      loads scoped signed URL via `/api/knowledge/[id]/view`; row-evidence handled.
- [x] Citation chips ([E#] → panel), agent-activity (tools/thinking), confidence UI.
- [x] **Knowledge upload UI**: admin `/admin/knowledge` page + upload dialog
      (title/file/visibility) → `uploadKnowledgeDocument`. (Per-user/dept grant
      picker → `setDocumentGrants` is the remaining sub-item; server side done.)
- [x] **`next build` green** — all routes compile incl. the edge Proxy bundle (the
      deferred P2/P3 build check); typecheck clean.
- [ ] Per-user/department **grant picker UI** (server action `setDocumentGrants`
      ready) and full **browser/Bedrock** run-through — needs a live run (see below).

**Exit:** ✅ chat UI + visualizer build green; scoped picker; citations open the
source. Live browser + Bedrock walkthrough pending credentials.

---

## Phase 8 — AWS deployment

**Goal:** production on Fargate.

Approach: **plain AWS CLI runbook** (no IaC for now — see the end of this doc for
the "revisit IaC" note). Uses the account's default VPC to stay simple.

- [x] `infra/aws/DEPLOY.md`: ordered CLI runbook — default VPC, security groups,
      ECR ×2 + image push, S3 (private), SQS (+DLQ), RDS Postgres 16 (pgvector),
      Secrets Manager, IAM (2 roles), CloudWatch, ECS cluster, Cloud Map (web→agent),
      ALB + target group + listener, 3 Fargate services, DB migrate, first admin, smoke test.
- [x] IAM policy JSONs (`infra/aws/iam/`): exec trust + secrets-read; task trust +
      S3/SQS/Bedrock (Bedrock `*`, noted to scope to model ARNs).
- [x] ECS task-def JSONs (`infra/aws/ecs/`, envsubst placeholders): web/agent/worker.
- [x] CI (`.github/workflows/deploy.yml`): path-filtered build+push to ECR + roll services.
- [x] `next.config` standalone output; gateway env override (AGENT_MODEL/EMBED_MODEL
      → Bedrock in prod, Gemini yaml locally).
- [ ] **Run pending your AWS account**: enable Bedrock model access (us-east-2),
      execute `infra/aws/DEPLOY.md`, migrate DB + RLS SQL, smoke test. **Phase 3b
      done** ✅ (web task def injects no Supabase env).

**Exit (code):** ✅ deploy runbook + task defs + IAM + CI authored. **Exit (live):**
pending your run.

---

## Phase 9 — Hardening & polish (ongoing)

- [ ] Eval set for retrieval quality + scope-leak regression tests in CI.
- [ ] Observability (Langfuse optional; CloudWatch logs/metrics; ingestion failures).
- [ ] Cost guardrails (Bedrock token budgets; alarms).
- [ ] Backups (RDS snapshots), S3 lifecycle for parse cache.
- [ ] Docs: runbook, onboarding, model-swap guide.

---

## Critical path & dependencies

```
P0 ─▶ P1 ─▶ P3 ─▶ P4 ─▶ P5 ─▶ P6 ─▶ P7 ─▶ P8
        └▶ P2 (auth, parallelizable after P1)
```

- P2 (auth) can run in parallel once P1's schema exists.
- P5 depends on P4 (need ingested data) and P1 (RLS).
- P7 depends on P6 (SSE) and P3 (picker needs grant data).
- Deploy (P8) only after the local end-to-end (P7) is green.

## Decisions (locked)
1. NextAuth sign-in: **credentials (email+password)** for v1; SSO later.
2. AWS region: **`us-east-2` (Ohio)** — closest to Texas, native Llama 3.3 70B.
3. Agent model: **Llama 3.3 70B Instruct** (`us.meta.llama3-3-70b-instruct-v1:0`).
4. Embeddings: **Titan Text Embeddings v2** (`amazon.titan-embed-text-v2:0`), 1024-dim.

## Future — revisit Infrastructure-as-Code (Terraform / CDK)
Deployment is intentionally a **plain AWS CLI runbook** (`infra/aws/DEPLOY.md`) for
v1 — simplest to understand and run by hand while the footprint is small. Once the
infra is stable and changes more often, port it to IaC for repeatability,
drift-detection, and easy teardown/rebuild:
- **Terraform** — portable, declarative, single source of truth (a first cut was
  written then removed by request; the resource shapes in DEPLOY.md map 1:1).
- **AWS CDK (TypeScript)** — likely the better fit for this TS-heavy repo
  (same language, typed, testable); needs `cdk bootstrap`.
Trigger to do this: more than one environment (staging/prod), or manual drift
becoming painful. Until then the runbook + task-def JSONs + CI are enough.
