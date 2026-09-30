# ACT ERP (`apps/web`)

American Completion Tools — internal workforce management platform. Next.js 16
app that owns the UI, authentication, RBAC, the Prisma schema for **every**
table in the system, and the gateway to the optional AI assistant (`apps/ai`).

> 📐 **Architecture & decisions:** [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)
> 🚀 **Deploy:** [`../../infra/aws/DEPLOY-LITE.md`](../../infra/aws/DEPLOY-LITE.md) (the live path)
> 🧑‍🔧 **Handover / ops:** [`../../HANDOVER.md`](../../HANDOVER.md)

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, RSC) on Node 22+ |
| Language | TypeScript strict |
| UI | shadcn/ui (new-york style, slate base, **emerald** accent) + Tailwind v3 |
| Fonts | Geist Sans · Geist Mono · JetBrains Mono (numerics) |
| State | React Query v5 (client) · Server Actions (mutations) · React `cache` (per-request) |
| Auth | **NextAuth v5** (credentials + JWT) with optional emailed 6-digit 2FA |
| Database | Postgres 16 + Prisma 6 + `pgvector` (self-hosted container; RDS in the full design) |
| Storage | **S3** (or any S3-compatible store via `AWS_ENDPOINT_URL`; LocalStack locally) |
| Queue | **SQS** — ingestion jobs only, used solely when `AI_ENABLED=true` |
| Email | Microsoft Graph (`Mail.Send`) in production, Amazon SES as fallback |
| Doc extraction | AWS Textract + optional Anthropic Claude gap-fill (hire-packet import) |
| Calendar | Schedule-X |
| Charts | shadcn `chart` block (Recharts under the hood) |
| Tables | TanStack Table v8 |
| Forms | react-hook-form + zod |
| Icons | Lucide · Toasts | Sonner · Animations | Framer Motion |
| Package manager | pnpm |

There is **no Supabase** anywhere in the runtime — auth, storage, and realtime
were migrated off it (Phase 3b). Notifications poll `/api/notifications/unread`
rather than using a realtime socket.

---

## Feature surface

| Area | Routes |
|---|---|
| Admin | employees, departments, job codes, schedules, time-tracking, leave, requests, reimbursements, payroll, benefits, documents, onboarding, notifications, activity (audit), settings, **kiosks** |
| Employee | my details, time-tracking, schedule, leave, requests, reimbursements, payroll, benefits, documents, team, notifications, settings |
| Shop floor | `/kiosk/[slug]` — shared time-clock terminal (see below) |
| Assistant (optional) | `/admin/chat`, `/dashboard/chat`, `/admin/knowledge` — only when `AI_ENABLED=true` |

Notable subsystems:

- **Kiosk time clock** — an admin registers a kiosk, then physically activates
  it at the terminal; activation is restricted to `KIOSK_ALLOWED_NETWORKS` and
  writes a hashed device cookie (`KioskSession.cookieHash`). Punches thereafter
  trust the device cookie, **not** the IP — facility egress IPs rotate on
  Starlink. Employees clock in/out with their employee ID + a 4-digit PIN
  (default `3214` until changed in employee settings; admins can reset it).
- **Login 2FA** — with `LOGIN_2FA_ENABLED=true`, a verified password creates a
  `LoginChallenge` (hashed 6-digit code, 5-attempt cap, expiring) and the code
  is emailed; NextAuth completes sign-in from the code. Set it to `false` for
  direct username/email + password sign-in. Users may sign in with **either**
  `email` or `username` — shop-floor hires often have no company mailbox.
- **Hire-packet import** — an admin uploads a ZIP of new-hire forms; files are
  classified, parsed with per-form templates over Textract text, optionally
  gap-filled with Claude (`ANTHROPIC_API_KEY`, off when unset), and surfaced as
  reviewable proposed field changes (`HirePacketImport`).
- **Benefits** — a read-only mirror of what the broker administers. No PHI, no
  dependent identities, no 401(k) balances; see the comment block in
  `prisma/schema.prisma`.
- **Payroll** — paystub PDF parsing + matching (`lib/paystub-parser.ts`,
  `lib/paystub-match.ts`), W-2 consent tracking.

---

## Local setup

### 1. Install
```bash
pnpm install
```

### 2. Configure environment
```bash
cp .env.example .env.local
```
Fill in at minimum `DATABASE_URL`, `AUTH_SECRET` (`openssl rand -base64 32`),
`S3_BUCKET`, and the email provider vars. `src/lib/env.ts` validates everything
at boot and fails fast on a half-configured deploy.

### 3. Create the schema
This project uses `db push` (there are no Prisma migration files):
```bash
pnpm db:push
```
> ⚠️ **Always re-apply `prisma/sql/01_rag_pgvector_rls.sql` afterwards.** The
> generated `tsv` column + GIN index, the two HNSW vector indexes, and the RLS
> role/policies live outside the Prisma schema and `db push` silently drops
> them. Only matters when the AI feature is in use, but it costs nothing to be
> consistent.

### 3b. Upgrading an existing database
There is no migration history (`prisma/migrations` does not exist on purpose:
`db push` and `migrate` must not be mixed). After pulling a release that changes
`schema.prisma`: back up, `pnpm db:push`, then run the idempotent data scripts
(safe to re-run): `scripts/normalize-emails.ts`, `scripts/seed-leave-policy.ts`,
`scripts/backfill-payroll-sha256.ts`. On the production box use the `tools` compose
service; see `infra/aws/DEPLOY-LITE.md` (section 5b). Raw SQL that `db push` cannot
express lives in `prisma/sql/` (`02_*.reference.sql` is reference only).

### 4. Create the first admin
```bash
pnpm tsx --env-file=.env.local scripts/create-admin.ts you@actools.com 'StrongPass#1' --name 'Your Name' --with-employee
```

### 5. Run
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000).

Full multi-service walkthrough (Postgres + LocalStack + the AI services):
[`../../LOCAL_RUN.md`](../../LOCAL_RUN.md).

---

## Project layout

```
src/
├── app/                     # Next.js App Router
│   ├── (admin)/admin/       # admin dashboard
│   ├── (employee)/dashboard/# employee self-service
│   ├── (kiosk)/kiosk/       # shop-floor time clock
│   ├── api/                 # auth, chat gateway, knowledge file/view,
│   │                        #   notifications, documents, payroll, …
│   ├── login/ onboard/ auth/ privacy/ unauthorized/
│   └── layout.tsx
├── components/
│   ├── ui/                  # shadcn primitives (do not edit)
│   ├── chat/ visualizer/    # Assistant UI + pdf.js citation viewer
│   ├── knowledge/           # knowledge-base admin UI
│   ├── admin-sidebar.tsx · employee-sidebar.tsx · providers.tsx · …
├── server/actions/          # server actions (the mutation surface)
├── lib/
│   ├── auth/                # auth.config.ts (edge) · auth.ts (Node) · password
│   ├── chat/ knowledge/ hire-packet/
│   ├── aws.ts storage.ts queue.ts email.ts
│   ├── kiosk-network.ts kiosk-pin.ts ip-network.ts rate-limit.ts
│   ├── db.ts env.ts features.ts audit.ts
│   └── paystub-parser.ts paystub-match.ts benefits.ts …
├── hooks/
├── types/
└── proxy.ts                 # edge auth gate (Next 16's renamed middleware)

prisma/
├── schema.prisma            # AUTHORITY for every table (ERP + AI)
└── sql/01_rag_pgvector_rls.sql   # tsv/GIN, HNSW, RLS role + policies
```

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server on `http://localhost:3000` |
| `pnpm build` / `pnpm start` | Production build / server (standalone output) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm db:push` | Push schema changes (the workflow this project uses) |
| `pnpm prisma:generate` / `prisma:studio` | Regenerate client / visual DB browser |
| `pnpm copy-pdf-worker` | Copy the pdf.js worker into `public/` (runs on postinstall) |
| `pnpm export:mongo` | Dump legacy MongoDB collections to CSV (`LEGACY_MONGO_URI=…`) |

Dev-only helper scripts (**never run in production**): `scripts/create-admin.ts`,
`scripts/seed-30-days.ts`, `scripts/seed-recent.ts`, `scripts/seed-topup.ts`,
`scripts/upload-knowledge.ts <dir>`, `scripts/requeue-failed.ts`.

---

## Feature flag: `AI_ENABLED`

Off by default. When `false`:

- Assistant / Knowledge base nav entries are hidden,
- `/admin/chat`, `/dashboard/chat`, `/admin/knowledge` render "Page not found",
- `POST /api/chat` returns 503 and `/api/knowledge/[id]/{file,view}` return 404,
- knowledge upload refuses instead of enqueueing to SQS,
- `SQS_QUEUE_URL`, `AGENT_SERVICE_URL`, `INTERNAL_SERVICE_TOKEN` are unused and
  may be left unset.

Setting `AI_ENABLED=true` without those three fails at boot with a clear
message rather than 500ing on first use. The current production deploy runs
with the flag **off** — see
[`../../infra/aws/LITE-MIGRATION-PLAN.md`](../../infra/aws/LITE-MIGRATION-PLAN.md).
