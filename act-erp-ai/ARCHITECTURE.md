# ACT ERP-AI — Architecture & Spec

Agentic RAG for the ACT ERP. An admin or employee uploads operational documents
(tool records, BOMs, manuals, spreadsheets); an authenticated user can chat with
an agent that retrieves **only from documents they are allowed to see**, over both
unstructured text (vector + full-text) and structured data (scoped SQL), with a
PDF visualizer that highlights cited passages.

> Status: **design locked, pre-build.** This document is the source of truth for
> the architecture. The build order lives in `IMPLEMENTATION_PLAN.md`.

---

## 1. Goals & non-negotiables

**Goals**
- Reuse the strong half of the v1 reference implementation: the agent loop, hybrid retrieval, SSE event
  model, and PDF visualizer.
- Add a **scoped SQL tool** so the agent answers from structured records (BOMs,
  tool records), not just prose.
- **RBAC on retrieval**: results are restricted to the authenticated user's
  allowed documents — enforced server-side, never trusted from the client.
- Single cloud vendor (**AWS**), single bill, low ops.
- Keep the existing ERP frontend exactly as-is; chat is one more feature.

**Non-negotiable invariants** (inherited from the v1 reference implementation, extended)
1. **Provenance** — every claim cites evidence (`[E#]`) that resolves to a real chunk/row.
2. **Scope** — the model can never widen its own document scope. Scope is computed
   in `web` and enforced in SQL `WHERE` clauses **and** Postgres RLS.
3. **Traceability** — every agent run is event-logged and replayable.

**Non-goals (explicitly out of scope for v1)**
- No LangChain / LangGraph (see §11).
- No microservice sprawl — exactly two deployables (see §3).
- No self-hosted LLM / GPU (see §8).
- No Redis, no Lambda (see §3, §6).
- No multi-agent graphs, no fine-tuning.

---

## 2. Key decisions (with rationale)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Reuse the v1 agent loop + SSE + visualizer**, do **not** adopt pydantic-ai | v1 already has the expensive 80% (SSE taxonomy, evidence/citation model, HITL, pdf.js bbox highlighting) and already does scope-injection via `RunContext`. pydantic-ai would mean rebuilding all that plumbing for a nicer tool syntax. |
| D2 | **No LangChain / LangGraph** | Single agent + N tools needs no graph runtime. LangChain's SQL toolkit generates arbitrary SQL — exactly the RBAC hole we forbid. Bloat the user explicitly rejected. |
| D3 | **LiteLLM gateway → Amazon Bedrock** | Keeps the provider-agnostic model layer; one config swap changes models. Bedrock = single AWS bill, IAM not API keys, data stays in-boundary. |
| D4 | **Bedrock open-weight model** (Llama 3.3 70B or gpt-oss-120b) + **Bedrock embeddings** (Titan v2 / Cohere, 1024-dim) | Pay-per-token, zero idle cost — fits ~300–500 queries/day. Strong tool-callers (weak models break provenance). Gemma rejected: not on Bedrock → self-host → idle GPU cost. |
| D5 | **Marker (Datalab) for PDF/DOCX**; **CSV/XLSX parsed directly** | Marker's structured tree is what powers `get_toc`/`read_section`. Structured files are already tabular — they bypass parsing entirely. Single parsing vendor. |
| D6 | **Async worker (SQS + Fargate), not Lambda** | Ingestion is long-running (Marker polling, batch embeds). Lambda's 15-min cap + cold starts fight that. SQS also lets us drop Redis. |
| D7 | **NextAuth v5, database sessions** | Fixes the "tokens live for days" problem — DB sessions are revocable; rolling 30m idle / 8h absolute. No extra vendor. |
| D8 | **Two services, monorepo** (`web` TS, `ai` Python) | Two runtimes are forced by language, not premature decomposition. Agent + worker share one image. |
| D9 | **Prisma owns the entire schema** | One Postgres, one migration tool, one source of truth. Python reads/writes via raw SQL / SQLAlchemy Core; no two-headed schema. |
| D10 | **ECS on Fargate** (×3 services) behind one ALB | Serverless containers, no OS/patching, scales to tiny load, one concept to learn. EC2/ECS-on-EC2 = needless sysadmin work at this scale. |
| D11 | **RBAC = per-user + org-wide grants**; frontend expands dept→users | ~80 employees; a whole dept is ~20 grant rows. No dept/role grant tables needed. Postgres RLS as defense-in-depth. |
| D12 | **Monorepo, one GitHub repo** | Schema spans both services; one team; atomic cross-service PRs. Path-filtered CI still deploys services independently. |

---

## 3. Service topology

Two languages → two deployables. The agent and the ingestion worker **share one
Python codebase and one Docker image** (different start command).

```
                    ┌──────────────┐
   browser ──cookie─▶│  web (Next)  │  UI, NextAuth, RBAC, /api/chat gateway
                    │   Prisma     │──┐
                    └──────┬───────┘  │ Prisma (owns schema)
                  service  │ SSE      │
                   token   ▼          ▼
                    ┌──────────────┐  ┌─────────────────┐
                    │ agent (FastAPI)│  │   Postgres      │
                    │  agent loop +  │─▶│  + pgvector     │
                    │  tools (read)  │  │  (RDS)          │
                    └──────────────┘  └────────▲────────┘
                                               │ raw SQL (read/write)
   upload ─▶ web ─▶ S3 + enqueue SQS           │
                            │                  │
                            ▼                  │
                    ┌──────────────┐           │
                    │ worker (SQS) │───────────┘   Marker, Bedrock embeddings
                    │  ingestion   │──▶ S3 (parses, images)
                    └──────────────┘
```

| Service | Image | Runtime | Inbound | Reaches |
|---------|-------|---------|---------|---------|
| `web` | web | Next.js 16 | browser (cookie), ALB | `agent` (service token), Postgres |
| `agent` | ai | FastAPI/uvicorn | `web` only (internal) | Postgres, Bedrock |
| `worker` | **ai (same image)** | SQS consumer | SQS | Postgres, S3, Marker, Bedrock |

**Docker images: 2. Running containers: 3.** No Redis, no Lambda, no GPU.

---

## 4. Repository layout

One repo, sibling services. The v1 reference implementation is **reference only** — not copied in; we
port the specific files we need.

```
act-erp-ai/
├── ARCHITECTURE.md            # this file
├── IMPLEMENTATION_PLAN.md
├── README.md
├── apps/
│   ├── web/                   # Next.js (from erp), owns Prisma schema
│   │   ├── prisma/schema.prisma   # AUTHORITY for all tables
│   │   └── src/...                # + chat feature, /api/chat proxy
│   └── ai/                    # Python: FastAPI agent + SQS worker (one image)
│       ├── agent/             # loop, tools, retrieval (ported + extended)
│       ├── ingestion/         # multi-format pipeline
│       ├── llm/               # LiteLLM gateway → Bedrock
│       ├── main.py            # uvicorn entrypoint (agent service)
│       └── worker.py          # SQS consumer entrypoint
├── infra/
│   ├── docker-compose.yml     # local: postgres(pgvector), web, agent, worker, localstack
│   ├── Dockerfile.web
│   ├── Dockerfile.ai
│   └── iac/                   # ECS/RDS/S3/SQS/ALB definitions
└── .github/workflows/         # path-filtered CI (build only what changed)
```

---

## 5. Data model

**Prisma owns every table.** Python uses raw SQL / SQLAlchemy Core against them.
pgvector columns are declared in Prisma (`Unsupported("vector(1024)")` or raw SQL
migration). Embeddings standardize on **1024 dims** (Titan v2 / Cohere).

### Business tables (existing ERP — unchanged)
Users, Employee, Department, time/leave/requests/etc. (see current erp schema).
`User.role ∈ {ADMIN, EMPLOYEE}` remains the role primitive.

### New AI tables

```
knowledge_document
  id, title, source_filename, mime_type, file_kind (PDF|DOCX|CSV|XLSX),
  s3_key, checksum (dedup), uploaded_by (User), owner_user_id (nullable),
  visibility (PRIVATE | ORG), status (queued|parsing|embedding|ready|failed),
  page_dimensions_json, created_at

document_grant            -- per-user access (visibility=ORG bypasses this)
  document_id → knowledge_document
  user_id     → User
  UNIQUE(document_id, user_id)

structure_node            -- heading tree (PDF/DOCX only)
  id, document_id, parent_id, depth, heading_text, breadcrumb, page_range

chunk                     -- text passages for retrieval
  id, document_id, structure_node_id, content, content_html,
  page_number, bbox, polygon, token_count,
  embedding vector(1024), tsv tsvector
  -- HNSW index on embedding, GIN index on tsv

doc_image                 -- figures/tables for the visualizer
  id, document_id, page_number, bbox, caption, figure_ref_norm, s3_key

-- Structured/relational extraction (BOMs, tool records)
record_table              -- one per ingested structured source / extracted table
  id, document_id, name, schema_json (column names/types)
record_row                -- generic row store (scoped by document_id)
  id, record_table_id, document_id, data_json, row_embedding vector(1024) NULL

-- Agent run logging (provenance/traceability)
agent_run                 id, user_id, status, scope_doc_ids_json, state_json, created_at
agent_run_event           id, run_id, seq, type, data_json   -- append-only, SSE replay
evidence_log              run_id, eid, source_kind (chunk|row), source_id
```

**Why a generic `record_row(data_json)` rather than a table per BOM type:** there
is no existing structured data and schemas vary per upload. A generic row store
keyed by `document_id` is scope-safe and flexible; the agent's query tools read
`data_json` with JSON operators. (If a dominant fixed schema emerges later, we can
promote it to a typed table without changing the contract.)

---

## 6. RBAC on retrieval (the core requirement)

Two enforcement layers. The model is **never** trusted to scope itself.

### Layer 1 — application (authoritative scope computation)
1. Browser hits Next.js `/api/chat` with the session cookie.
2. `web` resolves `getSessionUser()` → `userId`, `role`.
3. `web` computes the **allowed document set**:
   ```sql
   SELECT id FROM knowledge_document
   WHERE visibility = 'ORG'
      OR owner_user_id = :userId
      OR id IN (SELECT document_id FROM document_grant WHERE user_id = :userId)
      OR :role = 'ADMIN'      -- admins see all (matches existing ERP rule)
   ```
4. `web` passes `allowed_doc_ids` (+ the user's *selected* doc picker subset) to
   `agent` over an internal, service-token-authenticated call.
5. `agent` builds a `RunContext{ user_id, allowed_doc_ids }`. **Every tool**
   receives it; every query hard-filters `WHERE document_id = ANY(:allowed_doc_ids)`.

### Layer 2 — Postgres Row-Level Security (defense-in-depth)
The `ai` service connects as a **read-mostly DB role** with RLS enabled on
`chunk`, `record_row`, `doc_image`, `knowledge_document`. Per request:
```sql
SELECT set_config('app.allowed_docs', '{docid,docid,...}', true);  -- per-tx
-- RLS policy (SELECT, role act_rls):
--   USING ("documentId" = ANY(current_setting('app.allowed_docs', true)::text[]))
-- KnowledgeDocument ids are cuid (text). The worker connects as the table owner
-- and bypasses RLS for ingestion writes; the agent uses act_rls (read-only).
```
Even a buggy or model-influenced query **physically cannot** return out-of-scope
rows. This is why the SQL tool is safe (see §9).

### Grant management (frontend)
- Admin uploads → assign to users, a whole department (frontend expands dept→user
  rows), or mark `visibility = ORG`.
- Employee uploads → `owner_user_id = self`, `visibility = PRIVATE`.

---

## 7. Ingestion pipeline (multi-format)

Triggered by upload → S3 + SQS message → `worker` consumes. Forks by `file_kind`:

```
                 ┌── PDF / DOCX ──▶ Marker (Datalab, cached by checksum in S3)
                 │                    └▶ normalize tree → structure_node + chunk
                 │                    └▶ extracted tables → record_table/record_row
upload ─▶ SQS ─▶ │                    └▶ figures → doc_image (+ bytes to S3)
                 │
                 └── CSV / XLSX ─▶ pandas/openpyxl
                                      └▶ rows → record_table/record_row (direct)
                                      └▶ optional per-row text → embedding
```

Common tail for all kinds: **embed** (Bedrock, batched) → **quality gate** →
**commit** (one transaction) → set `status = ready`. DOCX falls back to
LibreOffice→PDF if Datalab DOCX support is insufficient.

Parse caching: Marker output keyed by `parses/{checksum}.json` in S3 — paid once
per unique file. Re-upload of an identical file short-circuits.

---

## 8. LLM & embeddings

- **Gateway:** LiteLLM, configured by a role-based `models.yaml` (ported from
  v1) — `roles: { agent, small, embeddings }`. Swapping models = config edit.
- **Region:** **`us-east-2` (Ohio)** — closest to Texas (lowest latency) and the
  native Bedrock region for Llama 3.3 70B.
- **Agent model (locked):** Bedrock **Llama 3.3 70B Instruct** via cross-region
  inference profile `us.meta.llama3-3-70b-instruct-v1:0`. Strong tool-caller,
  pay-per-token, zero idle cost. (gpt-oss-120b kept as a swap-in alternative.)
- **Embeddings (locked):** Bedrock **Titan Text Embeddings v2**
  (`amazon.titan-embed-text-v2:0`) at **1024 dims**. Chosen over Cohere: 8,192-token
  input (Cohere caps at 512 → forces re-chunking), ~5× cheaper, comparable MTEB
  quality, English-only is fine here.
- **Access:** IAM role on the Fargate task — no API keys to manage or leak.
- Bedrock model access must be enabled for these model IDs in `us-east-2` at setup.

---

## 9. Agent design

Ported from v1, extended with the SQL/record tools. **Single agent**, async
event-emitting loop, max ~15 iterations.

### Tools (all receive `RunContext`, all scope-injected)
| Tool | Source | Purpose |
|------|--------|---------|
| `search_chunks` | vector + FTS, RRF fusion | semantic + lexical retrieval over allowed docs |
| `get_toc` | structure_node | heading tree for a doc |
| `read_section` | structure_node + chunk | full text under a node |
| `expand_chunk` | chunk neighbors | context expansion around an `[E#]` |
| `get_images` | doc_image | figures/tables by ref or caption |
| **`query_records`** | **record_table/record_row** | **scoped structured lookups (BOMs, tool records)** |
| `ask_user` | — | HITL clarification; suspends the loop |

### `query_records` — the safe SQL tool
The agent does **not** write raw SQL. It calls a typed tool: pick a
`record_table` (from the scoped set), filter columns, sort/limit. The handler
builds a **parameterized** query and runs it under the **RLS role** (§6 Layer 2).
So even if the model crafts a hostile filter, RLS + parameterization bound it to
allowed rows. This is what makes "agent has an SQL tool" safe.

### Streaming & provenance
- Emits the v1 SSE taxonomy: `run_started`, `thinking_delta`, `text_delta`,
  `tool_started`, `tool_result`, `evidence_added`, `clarification_required`,
  `citation_map`, `confidence`, `run_completed`, `error`.
- Each event persisted to `agent_run_event` with monotonic `seq` (reconnect-replay).
- Post-generation citation verification: every `[E#]` must resolve → else flagged,
  confidence downgraded.
- Evidence now spans **two kinds**: `chunk` (text) and `row` (structured) — both
  cite-able, both visualizable (rows render as a table panel; chunks highlight in PDF).

---

## 10. Frontend integration

The existing erp UI is untouched except for additions.

- **Nav:** "Chat" entry added to both `admin-sidebar.tsx` and `employee-sidebar.tsx`.
- **Routes:** `/dashboard/chat` and `/admin/chat`, both rendering one shared
  `<ChatWorkspace>`; scope differs by role.
- **Three-pane layout:** left = access-scoped **document picker**; center = chat +
  agent activity; right = **DocumentVisualizer** (pdf.js, bbox highlight, citation jump).
- **Ported from the v1 frontend** (React 19 compatible): `visualizer/*`, `chat/*`,
  `lib/chat-types.ts`, `lib/chat-reducer.ts`, `lib/pdf.ts` — restyled to shadcn tokens.
- **`/api/chat` route handler** = the gateway: authenticate → compute
  `allowed_doc_ids` → proxy SSE from `agent`. Browser talks only to Next.js.
- **Upload:** existing upload UI → server action → S3 + SQS enqueue.

---

## 11. Why not a framework (LangChain / LangGraph / pydantic-ai)

- The PDF-centric tree-mapper is an **ingestion** concern; no agent framework helps it.
- One agent + N tools needs no graph runtime; the loop is ~200 lines and exists.
- LangChain's SQL toolkit emits **arbitrary SQL** — the precise RBAC hole we forbid.
- v1 already provides DI-style scoping (`RunContext`), SSE, visualizer, HITL —
  the things a framework is adopted to get. Reusing it is less code and less bloat.

---

## 12. Auth (NextAuth v5)

Fixes the current "sessions active for days" problem.

> **Note:** Auth.js v5's Credentials provider **only supports the JWT session
> strategy** (database sessions aren't available without manual session
> management). We get the same security properties a different way:

- **JWT strategy + `User.tokenVersion`** — the token carries a `tv` claim;
  `getSessionUser` compares it to the DB. `revokeUserSessions()` bumps
  `tokenVersion` → **instant logout-everywhere** on role change / termination /
  forced reset. No DB session table, no adapter (less bloat).
- **Role read from the DB** every request (not the JWT) → role changes are immediate.
- **Rolling 30-min refresh, 8-hour absolute** lifetime (`session.maxAge`/`updateAge`).
- Cookies `httpOnly` + `secure` + `sameSite=lax`; CSRF built-in.
- **MFA for ADMIN** (recommended; deferred).
- **Sign-in (locked):** email + password **credentials** for v1. SSO (Google/M365)
  added later — split config (`auth.config.ts` edge-safe + `auth.ts` Node) accepts
  new providers without rework.
- Proxy (Next 16's renamed middleware) does **optimistic** checks only; real authz
  is in Server Components via `requireAdmin()`/`requireUser()`.

---

## 13. AWS infrastructure

| Concern | Service | Notes |
|---------|---------|-------|
| Containers | **ECS on Fargate** ×3 (web, agent, worker) | no OS/patching, scales to load |
| Routing | **ALB** | `/` → web; internal listener → agent; worker has no inbound |
| Database | **RDS PostgreSQL** + pgvector | Aurora optional later |
| Object storage | **S3** | uploads, Marker parse cache, extracted images |
| Queue | **SQS** | ingestion jobs (replaces Redis/arq) |
| LLM | **Bedrock** | model + embeddings, IAM-auth |
| Doc parsing | **Datalab Marker API** | external, cached in S3 |
| Secrets | **SSM Parameter Store / Secrets Manager** | DB creds, service token, Datalab key |
| Auth | in-app (**NextAuth**) | no Cognito |

No EC2, no GPU, no Lambda, no Redis, no ElastiCache.

---

## 14. Local development

Single `infra/docker-compose.yml`:
- `postgres` (pgvector image) — schema applied via Prisma migrate.
- `web`, `agent`, `worker`.
- `localstack` — S3 + SQS locally, mirroring AWS without cloud access.

Mirrors production topology so "works locally" means "works on Fargate."

---

## 15. Security summary

- Scope enforced in two independent layers (app WHERE + Postgres RLS).
- Browser never calls `agent` directly; `web` is the only auth boundary.
- `agent`/`worker` reach the DB as a read-mostly RLS role.
- Secrets via IAM / Secrets Manager, not env files in images.
- Audit log (existing erp `audit()`) extended to document grants and uploads.
- Provenance verification rejects fabricated citations.
