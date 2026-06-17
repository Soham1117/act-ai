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

- [ ] Point `lib/storage.ts` at S3 (LocalStack locally) — single-file swap.
- [ ] Migrate existing Supabase Storage buckets/objects to S3.
- [ ] `knowledge_document` upload server action: write S3, create row
      (`status=queued`), set grants/visibility, enqueue SQS message.
- [ ] Grant UI: assign to users / department-expansion / `ORG`; employee self-upload.
- [ ] Audit log extended to uploads + grant changes.

**Exit:** uploading a file creates a `knowledge_document` row + an SQS message;
grants resolve correctly per user.

---

## Phase 4 — Ingestion worker (multi-format)

**Goal:** queued docs become retrievable (chunks/embeddings + structured rows).

- [ ] SQS consumer loop in `worker.py`.
- [ ] **PDF/DOCX path:** Marker (Datalab) call + S3 parse cache → normalize tree →
      `structure_node` + `chunk`; extracted tables → `record_table`/`record_row`;
      figures → `doc_image`. DOCX→PDF fallback via LibreOffice if needed.
- [ ] **CSV/XLSX path:** pandas/openpyxl → `record_table`/`record_row` directly;
      optional per-row text embedding.
- [ ] Common tail: Bedrock batch embeddings → quality gate → transactional commit →
      `status=ready`; failures → `status=failed` with reason.
- [ ] Dedup by checksum (short-circuit re-uploads).

**Exit:** upload one of each format (PDF, DOCX, CSV, XLSX) → all reach `ready` with
chunks and/or rows populated and embeddings present.

---

## Phase 5 — LLM gateway + retrieval

**Goal:** scoped hybrid retrieval and structured queries work against Bedrock.

- [ ] LiteLLM gateway + `models.yaml`; wire IAM/Bedrock (agent model + embeddings).
- [ ] `search_chunks`: vector (pgvector HNSW) + FTS (tsv) + RRF fusion, scoped.
- [ ] `query_records`: typed, parameterized structured query tool, run under RLS role.
- [ ] `get_toc`, `read_section`, `expand_chunk`, `get_images` (scoped).
- [ ] Unit tests: every tool returns **zero** out-of-scope results given a restricted
      `RunContext` (the core RBAC test).

**Exit:** given a fixed `allowed_doc_ids`, each tool returns only in-scope data;
embeddings/search produce sensible hits on the seeded corpus.

---

## Phase 6 — Agent loop + SSE

**Goal:** end-to-end agent run with provenance and streaming.

- [ ] Wire the ported loop to the new tool registry + `RunContext`.
- [ ] Emit full SSE taxonomy; persist `agent_run` + `agent_run_event` (seq replay).
- [ ] Evidence supports both `chunk` and `row` kinds in `evidence_log`.
- [ ] Citation verification + confidence scoring.
- [ ] `ask_user` HITL suspend/resume.
- [ ] `web` `/api/chat` route handler: auth → compute `allowed_doc_ids` → proxy SSE.

**Exit:** a curl/UI run streams events, cites real evidence, and a hostile prompt
("show me documents I don't own") returns nothing out-of-scope.

---

## Phase 7 — Chat frontend & visualizer

**Goal:** the Chat feature inside the existing erp UI.

- [ ] "Chat" nav entry in both sidebars; `/dashboard/chat` + `/admin/chat`.
- [ ] Shared `<ChatWorkspace>`: document picker (scoped) | chat+activity | visualizer.
- [ ] Wire ported chat reducer to the SSE stream from `/api/chat`.
- [ ] DocumentVisualizer: pdf.js bbox highlight + citation-jump; restyle to shadcn.
- [ ] Row-evidence panel for structured citations.
- [ ] Confidence + agent-activity UI.

**Exit:** a user logs in, picks allowed docs, asks a question, sees streamed answer
with citations, clicks a citation → visualizer highlights the passage/row. A
second user sees only *their* documents.

---

## Phase 8 — AWS deployment

**Goal:** production on Fargate.

- [ ] IaC (`infra/iac/`): VPC, RDS Postgres+pgvector, S3, SQS, ALB, ECS cluster.
- [ ] ECR repos; CI builds 2 images (web, ai), path-filtered.
- [ ] 3 Fargate services: web, agent (internal), worker (no inbound).
- [ ] Secrets in Secrets Manager / SSM; task IAM roles (Bedrock, S3, SQS, DB).
- [ ] Enable Bedrock model access in the chosen region.
- [ ] ALB routing + HTTPS (ACM cert); health checks.
- [ ] Smoke test: upload → ingest → chat → cite, end-to-end in AWS.

**Exit:** the full flow works in AWS; only one AWS bill; no Vercel/Supabase deps.

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
