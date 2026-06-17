# ACT ERP

American Completion Tools — internal workforce management platform. Successor to the legacy `old/employee-dashboard` build.

> 📋 **Single source of truth for design + scope:** `../revamp_plan.md` (one level up).
> 📚 **Reference for legacy behaviour:** `../old_PROJECT_OVERVIEW.md`.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, RSC) on Node 22+ |
| Language | TypeScript strict |
| UI | shadcn/ui (new-york style, slate base, **emerald** accent) + Tailwind v3 |
| Fonts | Geist Sans · Geist Mono · JetBrains Mono (numerics) |
| State | React Query v5 (client) · Server Actions (mutations) · React `cache` (per-request) |
| Auth | Supabase Auth (JWT, refresh rotation, RLS, MFA) |
| Database | Postgres (Supabase) + Prisma 6 + `pgvector` + `pg_trgm` |
| Storage | Supabase Storage (S3-compatible underneath) |
| Calendar | Schedule-X (added in Phase 3) |
| Charts | shadcn `chart` block (Recharts under the hood) |
| Tables | TanStack Table v8 |
| Forms | react-hook-form + zod |
| Icons | Lucide |
| Toasts | Sonner |
| Animations | Framer Motion |
| Logger | pino |
| Package manager | pnpm |

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
Then fill in:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase Dashboard → Settings → API)
- `SUPABASE_SERVICE_ROLE_KEY` (same page; **server-only**)
- `DATABASE_URL` (Settings → Database → Connection string → **Transaction** pooler)
- `DIRECT_URL` (Settings → Database → Connection string → **Direct connection**)

### 3. Migrate the database
```bash
pnpm prisma:migrate --name init
```
This applies the schema to Supabase Postgres. The `pgvector` and `pg_trgm` extensions are enabled automatically.

### 4. Seed realistic demo data
```bash
pnpm seed:all
```
Provisions 48 Supabase auth users + employees, fills 12 months of timesheets,
leaves, reimbursements, requests, notifications, payroll periods + audit
events. Prints a credentials table at the end. Primary admin login:

```
marcus.holloway@actools.com / Holloway$2026
```

### 5. Run
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000).

### Optional: migrate from legacy MongoDB
```bash
LEGACY_MONGO_URI="mongodb+srv://…" pnpm export:mongo
```
Dumps every legacy collection to `data/raw/<collection>.csv`. Useful if you
need the historical data carried forward — `seed:all` produces a fresh
believable dataset on its own.

---

## Project layout

```
src/
├── app/                  # Next.js App Router
│   ├── (auth)/           # Phase 1 — login / onboard / unauthorized
│   ├── (admin)/          # Phase 2+ — admin dashboard
│   ├── (employee)/       # Phase 2+ — employee self-service
│   ├── (kiosk)/          # Phase 3 — shop-floor time clock
│   ├── api/v1/           # REST surface (future mobile)
│   ├── layout.tsx
│   └── page.tsx          # Phase 0 status screen
├── components/
│   ├── ui/               # shadcn primitives (do not edit)
│   ├── providers.tsx     # Theme + React Query + Toaster
│   └── ...               # feature components added per phase
├── lib/
│   ├── auth/             # getSessionUser, requireAdmin
│   ├── supabase/         # client, server, middleware, service-role
│   ├── db.ts             # Prisma singleton
│   ├── env.ts            # @t3-oss/env-nextjs validation
│   ├── storage.ts        # Supabase Storage wrapper
│   └── utils.ts          # cn() helper
├── hooks/                # use-toast, use-mobile (shadcn)
└── middleware.ts         # auth + role gate

prisma/
└── schema.prisma         # Phase 0 subset (User, Employee, Department, JobCode, AuditLog)
```

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server (Turbopack) on `http://localhost:3000` |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm prisma:migrate --name <name>` | Generate + apply a new migration |
| `pnpm prisma:generate` | Regenerate Prisma client only |
| `pnpm prisma:studio` | Visual DB browser |
| `pnpm prisma:reset` | Drop + recreate the DB (⚠ data loss) |
| `pnpm db:push` | Push schema changes without a migration (dev shortcut) |

---

## Status

**Phase 0 — Scaffold ✅**

What's wired:
- Next.js 16 + TypeScript + App Router
- shadcn/ui (new-york) + Tailwind v3 + emerald theme + dark default
- 42 shadcn components installed (button, card, input, form, table, dialog, sheet, sidebar, sonner, chart, calendar, command, …)
- Prisma 6 schema for identity + employees + audit log
- Supabase clients (browser, server, service-role, middleware)
- Auth helpers (`requireUser`, `requireAdmin`)
- Storage abstraction
- React Query + Theme + Toaster providers
- ESLint + Prettier + Tailwind class sorting

**Next: Phase 1 — Auth + Sidebar shell.**

See `../revamp_plan.md` §9 for the full phased roadmap.
