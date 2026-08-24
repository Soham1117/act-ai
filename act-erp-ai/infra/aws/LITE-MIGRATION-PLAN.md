# ACT Persona — stripped-down stack: migration plan

## Scope update — shared instance with ACT Beacon + ACT Prism

This box now hosts three apps, not one: **ACT Persona** (this repo), **ACT
Beacon** (visitor check-in — Fastify API + media/Textract service + Postgres;
its kiosk frontend stays on Netlify, not this box), and **ACT Prism**
(fabrication job tracking — FastAPI + Postgres, frontend built static and
served via nginx).

Both Beacon and Prism's compose files currently target a separate
"always-on Windows shop server" (Tailscale Funnel / LAN), not the cloud —
this plan brings their web+API+DB layers onto the same Lightsail box as
Persona. **ACT Prism's AI analyst and voice dictation stay off this box** —
they currently run a local 7B model via Ollama (4.7GB, needs ~6GB+ RAM
loaded) on the shop server. Moving that too would mean a 10–16GB instance and
noticeably slower CPU-only inference; decided against for this deploy.

**Instance size: 4 vCPU / 8GB RAM** (Lightsail `xlarge` tier). All three
apps' containers together use well under 1GB at idle (verified from the
already-running ACT Prism containers), but images build *on the box itself*
in this plan, and a `next build` / Python build can spike well above idle —
sized for that headroom, not steady-state traffic.

Optimization available later, not needed now: each app runs its own Postgres
container (three total). Consolidating to one shared Postgres server (three
databases) would trim a few hundred MB and simplify backups.

---

Goal: ship the ERP (employees, HR, time-tracking, payroll, documents) on one
small box, with the AI document-chat feature **built but switched off**.
Target ~$15–30/month for ~35 employees.

Companion docs: [`DEPLOY-LITE.md`](./DEPLOY-LITE.md) (the runbook this plan
feeds into), [`DEPLOY.md`](./DEPLOY.md) (the original full ECS design).

---

## Guiding decision: flag it off, don't delete it

The AI feature is cleanly decoupled — `apps/web` reaches the agent from
exactly one file (`src/app/api/chat/route.ts`), and SQS is used from exactly
one place (`uploadKnowledgeDocument`). Nothing in employees / time / leave /
payroll / documents touches either.

So we **feature-flag** rather than delete:

| | Delete AI code | Flag it off (chosen) |
|---|---|---|
| Effort now | High (rip out schema, deps, routes) | Low (~6 small edits) |
| Re-enabling later | Re-implement / revert a big commit | Flip one env var |
| Risk of breaking core ERP | Real | Near zero |
| Runtime cost when off | $0 | $0 (routes never load; Next code-splits per route) |

Dead weight from keeping it is negligible: the AI Prisma tables are empty
(no storage cost), and `pdfjs-dist` / chat components only ship in the
route bundles that are never reachable when the flag is off.

---

## Part A — Code changes

Six changes. None touch business logic.

### A1. Feature flag + relax env validation

`src/lib/env.ts` currently **requires** `SQS_QUEUE_URL`, `AGENT_SERVICE_URL`,
and `INTERNAL_SERVICE_TOKEN`. In a no-AI deploy those are meaningless, and
`DEPLOY-LITE.md` currently works around it with fake placeholder values —
which is exactly the kind of thing that rots into a real outage later.

Add `AI_ENABLED` (default `false`) and make the three AI vars optional,
validated **only** when `AI_ENABLED=true`. Then delete the placeholder block
from `.env.prod-lite.example`.

### A2. Hide the nav entries

`src/components/admin-sidebar.tsx` (lines ~48, ~75) and
`src/components/employee-sidebar.tsx` (line ~42) hardcode Assistant /
Knowledge base nav items. Filter them out when the flag is off, so users
aren't shown links that 404.

### A3. Guard the routes (defense in depth)

Hiding nav is cosmetic; the URLs still resolve. When the flag is off:

- `/admin/chat`, `/dashboard/chat`, `/admin/knowledge` → `notFound()`
- `POST /api/chat` → `503`
- `/api/knowledge/[id]/file`, `/api/knowledge/[id]/view` → `404`

**Verified behaviour, with one wrinkle:** the three pages render the
"Page not found" screen and leak no data, but return HTTP **200**, not 404.
Next.js commits the response status when it streams the layout shell, before
the page component runs `notFound()`. The content is right and nothing leaks;
only the status line is wrong. Making it a true 404 would mean blocking in the
edge proxy instead, which would bake the flag in at build time — a worse
trade than an incorrect status code on a hidden route.

### A4. Guard the SQS call

`uploadKnowledgeDocument` (`src/server/actions/knowledge.ts:117`) calls
`enqueueIngestion`. It's unreachable once A3 lands, but throw an explicit
"AI ingestion is disabled" error rather than letting it fail obscurely
against a bogus queue URL.

### A5. Keep the Prisma schema exactly as-is

**Do not** drop the AI tables. Two reasons:

1. **`vector` columns are on core business tables**, not just AI ones —
   `Employee.embedding`, `Notification.embedding`, `Document.embedding`.
   The pgvector extension is required regardless. The compose file must
   keep the `pgvector/pgvector:pg16` image; a plain `postgres:16` image
   will fail `prisma db push`.
2. ~10 extra empty tables cost nothing and keep re-enabling AI a one-step
   operation.

`prisma/sql/01_rag_pgvector_rls.sql` is **not** applied in this deploy — it
only builds the tsv/HNSW/RLS objects the agent uses. (Re-apply it if AI is
ever switched on.)

### A6. ~~Drop the dead `mongodb` dependency~~ — **not dead, leave it**

Initially flagged as unused. It isn't: `scripts/export-mongo.ts` imports it
for a one-off legacy-data export. It's a `devDependency` and the Dockerfile's
runner stage only copies `.next/standalone`, so it never reaches the
production image anyway. **No change** — removing it would break a migration
script that may still be needed.

---

## Part A-bis — 🔴 `next build` is broken on `main` (pre-existing)

**This blocks deployment.** `infra/Dockerfile.web` runs `pnpm build`, so the
image cannot be produced until it's resolved. Confirmed pre-existing by
stashing all of this session's work and rebuilding the untouched tree — it
fails identically.

**Symptom:** compilation succeeds, then static export dies:

```
Error occurred prerendering page "/_global-error"
TypeError: Cannot read properties of null (reading 'useContext')
```

**Root cause:** during static prerender of Next's *synthetic* pages
(`/_global-error`, `/_not-found`), React's hook dispatcher is null, so **any**
hook throws. It surfaced first as `useState` in `providers.tsx`, then as
`useContext` from `next-themes` — reached via `<ThemeProvider>` and via
`ui/sonner.tsx`, which calls `useTheme()`. Proven by removing `ThemeProvider`:
both synthetic pages then prerender fine. It is a framework-level problem, not
app code.

**Ruled out by testing:**

| Hypothesis | Result |
|---|---|
| Caused by this session's changes | ✗ — clean tree fails identically |
| Duplicate React copies | ✗ — single react/react-dom 19.2.4 |
| React ≠ Next's vendored React (19.3.0-canary) | Partial — pinning the canary fixed `/_global-error`, then failed at `/_not-found`. Reverted; pinning a canary is not a call to make for a payroll system without your sign-off. |
| Next 16.2.6 bug fixed upstream | ✗ — 16.3.2 (latest stable) fails identically. Reverted. |
| Missing custom `global-error.tsx` | ✗ — added one; Next still prerenders its internal page. |

**Fixes already applied** (each independently justified, all retained):

- `export const dynamic = "force-dynamic"` in the root layout and both route
  group layouts. Correct regardless: this is a private, auth-gated, DB-backed
  ERP where no route benefits from static generation. This alone fixed every
  *real* page — only Next's synthetic pages still fail.
- `providers.tsx` now uses React Query's documented App Router pattern
  (`getQueryClient()`) instead of `useState`. Also a genuine correctness win:
  a fresh client per server render means cached data can't leak between
  requests, which matters on session-scoped pages.
- Added `src/app/global-error.tsx` (good practice regardless).

**`<Providers>` relocation — attempted, did NOT fix it.** Providers now live in
the route-group layouts (`(admin)`, `(employee)`, `(kiosk)`) plus new layouts
for `/login`, `/onboard`, `/auth`; the root layout is hook-free, with `dark` as
the baseline `<html>` class so the provider-less 404 still matches the app
theme. Good architecture, and retained — but `/_global-error` still fails.

**Also ruled out since:** webpack instead of Turbopack (`next build --webpack`);
a from-scratch `node_modules` reinstall; React canary *combined with* the
relocation; and removing the custom `global-error.tsx`. With every app-level
provider gone from that render path, the `useContext` still throws **inside
Next's own bundled code** — so this is not reachable from application code.

Note the failing page name varies between runs (`/_global-error`,
`/_not-found`, `/kiosk`) because export runs across 23 parallel workers and
aborts on whichever fails first. Multiple pages are affected; it is systemic.

### The most promising untested lead: Node version

This host runs **Node 26.7.0**. `infra/Dockerfile.web` builds on **node:22-slim**.
Next 16.2.6 declares `engines.node: ">=20.9.0"` — a lower bound only; it long
predates Node 26 and was never tested against it. A React-internals crash that
appears under one Node major and not another is entirely consistent with this.

**The build may well succeed in Docker (Node 22) even though it fails on the
host.** If so this was never a deployment blocker — only a local-dev annoyance.

I could not confirm it: the Docker build fails earlier, at `pnpm install`, with
repeated `error (23)` (write error) on exactly the largest tarballs (`next`,
`@prisma/client`, `@next/swc-linux-x64-gnu`) while small packages succeed. Not
disk — the Docker VM has 894 GB free and host has 300 GB+. That signature is a
large-transfer networking problem in the local Docker/WSL2 setup, unrelated to
this repo.

**Next step:** get the Docker build past `pnpm install` (retry on a different
network, or lower the WSL2 MTU), then run it. That single test decides whether
any further work is needed here.

### Bug fixed along the way

`infra/Dockerfile.web` copied only `package.json` and `pnpm-lock.yaml` into the
`deps` stage, omitting **`pnpm-workspace.yaml`** — which is where
`onlyBuiltDependencies` lives. Without it modern pnpm aborts with
`ERR_PNPM_IGNORED_BUILDS`, so the image could never build regardless of the
prerender issue. Fixed.

---

## Part B — Security items to settle before real payroll data

Two fixes already landed this session (authenticated file-proxy routes
replacing permanent presigned S3 URLs; kiosk PIN + rate limiting). Three
remain, and the first is a genuine blocker.

### B1. 🔴 SSN is stored in plaintext

`prisma/schema.prisma:162` claims:

> `/// Stored encrypted at rest by Postgres pgcrypto in production.`

**This is not true.** There is no pgcrypto anywhere in the repo;
`employees.ts:53` and `onboarding.ts:131` write `ssn: data.ssn` straight
through. Every SSN sits readable in Postgres — and therefore in every
`pg_dump` backup we're about to start shipping to S3.

**Decision: store last-4 only.** Payroll is upload-a-PDF (processed
externally), so the ERP never needs the full number — last-4 is enough to
identify a record against an external payroll system. This removes the
sensitive data rather than protecting it: no key management, no backup
exposure, nothing to leak.

Implementation:

- `Employee.ssn String @unique` → `ssnLast4 String?`
- **Drop the `@unique`.** Last-4 is not unique — across 35 employees the
  birthday-paradox collision probability is roughly 6%, so a unique index
  would eventually reject a legitimate hire.
- Input forms/validators accept the last 4 digits only; never transmit or log
  the full number.
- Fix the false schema comment.

No data migration needed — the production DB doesn't exist yet.

### B2. Postgres must not be internet-reachable

`docker-compose.prod-lite.yml` deliberately publishes no port for Postgres.
The one-time migration step in `DEPLOY-LITE.md` temporarily binds it to
`127.0.0.1` for an SSH tunnel — confirm that line is removed afterward.

### B3. Backups contain PII

Instance snapshots and any `pg_dump` to S3 hold the same payroll/SSN data as
the live DB. The bucket must be private + encrypted + versioned (covered in
Part C), and the backup objects need a retention/lifecycle policy.

---

## Part C — AWS resources

**Nothing needs "enabling" at the account level.** The one AWS service that
requires explicit opt-in is Bedrock model access — and we're not using it.
Everything below is just creating resources on demand.

| Service | Why | Est. $/mo |
|---|---|--:|
| Lightsail instance | runs web + Postgres + Caddy | $12–24 |
| Lightsail static IP | stable DNS target (free while attached) | $0 |
| Lightsail auto-snapshots | daily instance backup | $1–3 |
| S3 bucket | uploaded documents, paystubs, avatars, DB dumps | $1–3 |
| IAM user + policy | scoped S3 credentials for the app | $0 |
| Route 53 *(optional)* | DNS, if not already hosted elsewhere | $0.50 |

**Explicitly NOT used:** ECS, ECR, Fargate, ALB, RDS, SQS, Secrets Manager,
Bedrock, Datalab. That's where the savings come from.

### C1. Verify access and region

```bash
aws sts get-caller-identity
export AWS_REGION=us-east-2
```

### C2. Lightsail instance + static IP + firewall

Confirm current bundle sizes/prices first (IDs and rates change):

```bash
aws lightsail get-bundles --region us-east-2 \
  --query 'bundles[].{id:bundleId,ram:ramSizeInGb,cpu:cpuCount,usd:price}' --output table
```

Then (bundle id chosen from that output — `small_3_0` ≈ 2 GB is a reasonable
start, `medium_3_0` ≈ 4 GB if Postgres + Next on one box feels tight; resizing
later means a snapshot-and-restore, so err larger if unsure):

```bash
aws lightsail create-instances \
  --instance-names act-persona \
  --availability-zone us-east-2a \
  --blueprint-id ubuntu_24_04 \
  --bundle-id small_3_0

aws lightsail allocate-static-ip --static-ip-name act-persona-ip
aws lightsail attach-static-ip --static-ip-name act-persona-ip --instance-name act-persona
```

Firewall — 80/443 open to the world (Caddy + ACME), **22 restricted to your
own IP**, not `0.0.0.0/0`:

```bash
MYIP=$(curl -s https://checkip.amazonaws.com)
aws lightsail put-instance-public-ports --instance-name act-persona \
  --port-infos \
    fromPort=80,toPort=80,protocol=TCP \
    fromPort=443,toPort=443,protocol=TCP \
    fromPort=22,toPort=22,protocol=TCP,cidrs="${MYIP}/32"
```

Daily snapshots:

```bash
aws lightsail enable-add-on --resource-name act-persona \
  --add-on-request 'addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=07:00}'
```

### C3. S3 bucket — private, encrypted, versioned

```bash
BUCKET=act-persona-docs   # must be globally unique; adjust if taken

aws s3api create-bucket --bucket "$BUCKET" --region us-east-2 \
  --create-bucket-configuration LocationConstraint=us-east-2

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled
```

### C4. IAM user scoped to just that bucket

```bash
cat > /tmp/act-s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::${BUCKET}" },
    { "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject"],
      "Resource": "arn:aws:s3:::${BUCKET}/*" }
  ]
}
EOF

aws iam create-user --user-name act-persona-app
aws iam put-user-policy --user-name act-persona-app \
  --policy-name act-persona-s3 --policy-document file:///tmp/act-s3-policy.json
aws iam create-access-key --user-name act-persona-app
```

The returned key/secret go into `apps/web/.env.prod`. **They are printed
once** — capture them immediately. They are the only long-lived credential in
this design.

### C5. Nightly DB dump → S3 (separate from instance snapshots)

Instance snapshots protect against box loss; a logical dump protects against
data corruption and makes restores selective. On the box, a cron entry:

```bash
docker exec $(docker ps -qf name=postgres) pg_dump -U act act \
  | gzip | aws s3 cp - "s3://${BUCKET}/backups/act-$(date +%F).sql.gz"
```

Add a lifecycle rule to expire `backups/` after ~30–90 days (see B3 — these
contain payroll PII).

---

## Part D — Execution order

1. ✅ **A1–A6** — done. Typecheck clean; verified locally with
   `AI_ENABLED` unset: nav hidden, chat/knowledge render "Page not found",
   `/api/chat` → 503, core ERP unaffected.
2. ✅ **B1** — done. Full SSN removed from schema, forms, and seed data;
   last-4 only.
3. 🔴 **A-bis** — fix `next build`. **Blocks everything downstream**, since
   the Docker image can't be built. Pick an option above.
4. **C1–C4** — provision AWS. *This is where I need credentials.*
5. **`DEPLOY-LITE.md`** — deploy, migrate schema, create first admin, smoke test.
6. **C5** — turn on backups, then verify a restore actually works.

---

## What I need to proceed with Part C

| Item | Why |
|---|---|
| AWS credentials (or a profile name already configured) | create the resources |
| Region confirmation — `us-east-2`? | matches existing docs |
| Domain/subdomain for the app | Caddy TLS + `NEXT_PUBLIC_SITE_URL` |
| Is DNS in Route 53, or elsewhere? | decides whether I create the record or hand you one |
| Preferred bucket name (default `act-persona-docs`) | must be globally unique |

An IAM principal with Lightsail, S3, and IAM-user-creation rights is enough —
it does not need admin.
