# ACT ERP — lite deploy runbook (no AI/chat)

Single small instance running `web` + Postgres + Caddy via Docker Compose.
No ECS, no ALB, no SQS, no Bedrock, no Datalab. Everything except the AI
document-chat feature works identically to the full design — RBAC, auth,
employees, time-tracking, leave, payroll, documents, reimbursements are all
in `apps/web` and don't touch the AI service.

**Est. cost:** ~$15–30/month all-in for ~35 employees. See the cost note at
the bottom for the breakdown.

**Add AI chat later:** nothing here needs to be undone. Bring `ai-agent` /
`ai-worker` (from `infra/docker-compose.yml`) onto this box or a second one,
add Bedrock model access + a Datalab key, point `AGENT_SERVICE_URL` at the
agent, re-run `prisma db push` + `prisma/sql/01_rag_pgvector_rls.sql` for the
vector/RLS objects. Everything else is unaffected.

---

## 1. Provision the box

**AWS Lightsail** (simplest — bundled static IP, firewall, automatic
snapshots, flat pricing): create a $10–20/mo instance (2 vCPU / 2–4 GB, "OS
Only: Ubuntu 24.04"), attach a static IP, open ports 80/443/22 in the
Lightsail firewall UI.

(EC2 `t4g.small`/`t3.small` + an EBS volume works identically if you prefer
staying in the main AWS console — same commands below either way.)

```bash
ssh ubuntu@<static-ip>
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in once for this to take effect
```

## 2. S3 bucket (for document/payroll/profile-pic uploads)

Plain S3 bucket, private, or a Lightsail bucket if you'd rather manage it in
the same console as the instance — the app talks S3-compatible API either
way (`AWS_ENDPOINT_URL` in `.env.prod` overrides the endpoint if not using
real AWS S3). Create an IAM user (or Lightsail bucket access key) scoped to
just this bucket — `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on
`arn:aws:s3:::your-bucket-name/*`. That key/secret goes in `.env.prod`.

## 3. Get the code + configs onto the box

```bash
git clone <your-repo-url> act-erp-ai
cd act-erp-ai/infra
cp postgres.env.example postgres.env          # set a real password
cp Caddyfile.example Caddyfile                # FIRST INSTALL ONLY - see "Security notes": never overwrite a live Caddyfile
cp ../apps/web/.env.prod-lite.example ../apps/web/.env.prod
# edit apps/web/.env.prod: DATABASE_URL/DIRECT_URL password (match postgres.env),
# AUTH_SECRET (openssl rand -base64 32), S3 creds, NEXT_PUBLIC_SITE_URL
```

## 4. Point DNS at the box

A record for your domain/subdomain → the static IP. Caddy handles the TLS
cert automatically on first request once DNS resolves (needs 80 and 443
reachable from the internet for the ACME challenge).

## 5. Bring it up

All commands below run **on the box** from `act-erp-ai/infra`. Set a shell
alias once so they stay short:

```bash
alias dc='docker compose -f docker-compose.prod-lite.yml'
```

```bash
dc up -d --build          # builds web, starts postgres + web + caddy
```

### 5a. Create / upgrade the database schema

This project uses **`prisma db push`** (there are no Prisma migration files, so
never use `prisma migrate`). The runtime `web` image is a slim standalone build
and has **no Prisma CLI**, so schema work runs in the one-shot `tools` service
(built from the Dockerfile's `build` stage, which has Prisma, tsx, `scripts/`,
and reads the same `apps/web/.env.prod`; it talks to Postgres over the internal
compose network, so no SSH tunnel or published port is needed):

```bash
dc run --rm tools prisma db push
```

If Prisma says a change could lose data it stops and asks; answer **no**, and
read "Schema upgrade on every deploy" below before doing anything else. Never
add `--accept-data-loss` without a fresh backup and a reason.

(`prisma/sql/01_rag_pgvector_rls.sql` is **not** needed for this deploy; it only
sets up the vector/RLS objects the AI feature uses.)

### 5b. Schema upgrade on every deploy that touches `schema.prisma`

The app code and the database schema must be upgraded together. Whenever a
release changes `apps/web/prisma/schema.prisma` (check with
`git diff <old>..<new> -- apps/web/prisma/schema.prisma`), do it in **this
order** (the app is briefly unavailable between steps 3 and 4 if the change is
not backward compatible; do it outside working hours):

1. **Back up first** (never skip):
   `BACKUP_S3_URI=s3://<backup-bucket>/act-erp infra/scripts/backup-db.sh`
   and confirm it printed `OK s3://...`.
2. `git pull`
3. `dc build web tools` (no restart yet; old containers keep serving)
4. `dc run --rm tools prisma db push` (additive changes such as new tables,
   columns and enum values apply cleanly; a destructive prompt means stop and
   restore/ask before continuing)
5. Run any **data scripts** the release notes call for (section 6b). They are
   idempotent, so re-running is safe.
6. `dc up -d web` (recreates the web container with the new code)
7. Smoke test (section 7) and watch `dc logs -f web` for a couple of minutes.

If the new code is live against the **old** schema you will see Prisma errors
("column does not exist"); that is the symptom of skipping step 4.

## 6. Create the first admin

```bash
dc run --rm tools tsx scripts/create-admin.ts 'you@company.com' 'StrongPass#1' --name 'Your Name' --with-employee
```

Re-running the script for the same login email resets that admin's password and
signs out their existing sessions. To **add a second admin**, run it again with a
different email (recommended: have at least two admins so one can reset the
other), or promote an existing employee from the admin Employees screen once
logged in. Run `create-admin` with `--help`/no arguments to see its current usage.

### 6b. One-off data scripts (run on deploy, all idempotent)

Run these after `db push` when upgrading an existing database (they are safe
no-ops on a fresh one):

```bash
# Lower-case every login email/username so sign-in is case-insensitive
dc run --rm tools tsx scripts/normalize-emails.ts
# Create the default leave policy rows (existing/edited rows are never overwritten)
dc run --rm tools tsx scripts/seed-leave-policy.ts
# Store checksums for old paystubs so the duplicate-upload guard covers them too
dc run --rm tools tsx scripts/backfill-payroll-sha256.ts
```

## 7. Smoke test

Visit `https://your-domain`, log in, click through Employees / Payroll /
Documents. Confirm file upload+download round-trips (proves S3 creds work).
Also: `curl -fsS https://your-domain/api/health` should print `{"status":"ok"}`
(200 means the app can reach the database; 503 means it cannot).

---

## Backups and restore

Two layers: (1) Lightsail/EBS snapshots of the whole box (coarse, easy), and
(2) **nightly logical dumps to S3** (`infra/scripts/backup-db.sh`), which are
what you restore from for "someone deleted data yesterday" or a corrupted DB.
Also keep the **uploads bucket** safe (versioning below); the database only
stores file keys, so DB backups alone do not restore documents.

### One-time S3 setup for backups

Use a separate bucket from the uploads bucket (so a bug or key leak in the app
cannot delete its own backups). Replace `ACT-BACKUPS` and the region:

```bash
aws s3api create-bucket --bucket ACT-BACKUPS --region us-east-2 \
  --create-bucket-configuration LocationConstraint=us-east-2
aws s3api put-public-access-block --bucket ACT-BACKUPS \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket ACT-BACKUPS \
  --versioning-configuration Status=Enabled

# Retention: dumps expire after 35 days; old versions/deleted markers after 30.
cat > lifecycle.json <<'JSON'
{
  "Rules": [
    {
      "ID": "expire-db-dumps",
      "Status": "Enabled",
      "Filter": { "Prefix": "act-erp/db/" },
      "Expiration": { "Days": 35 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 3 }
    }
  ]
}
JSON
aws s3api put-bucket-lifecycle-configuration --bucket ACT-BACKUPS \
  --lifecycle-configuration file://lifecycle.json
```

The AWS identity that runs the backup needs only `s3:PutObject` (and
`s3:ListBucket` for restores / `s3:GetObject` on the restore host) on
`arn:aws:s3:::ACT-BACKUPS/act-erp/*`. Put it in `~/.aws/credentials` for the
cron user (or use an instance profile); the scripts never print credentials.

Turn on versioning for the **uploads** bucket too, so an accidental
delete/overwrite of a payslip or document is recoverable:

```bash
aws s3api put-bucket-versioning --bucket <uploads-bucket> \
  --versioning-configuration Status=Enabled
```

### Schedule it

```bash
sudo apt-get install -y awscli     # or the AWS CLI v2 installer
chmod +x infra/scripts/*.sh
crontab -e                         # paste the line from infra/scripts/backup.cron.example
```

Run it once by hand first and confirm the object shows up
(`aws s3 ls s3://ACT-BACKUPS/act-erp/db/ --recursive`). Check
`/var/log/act-erp-backup.log` weekly, or add a dead-man's-switch ping
(healthchecks.io) to the cron line so silence raises an alert.

### Restore test (do this now, then monthly; an untested backup is not a backup)

```bash
infra/scripts/restore-db.sh s3://ACT-BACKUPS/act-erp/db/<year>/<file>.dump.gz
```

It restores into a throwaway database `act_restore_test` (never the live one),
prints row counts and the newest audit-log timestamp, then drops it (`--keep`
keeps it for inspection). It exits non-zero on any failure.

### Disaster recovery (restore over the live database)

Deliberately manual. Stop the app so nothing writes during the restore, restore
into a fresh database, then swap:

```bash
dc stop web
# 1. fetch + restore to a scratch DB and verify (above, with --keep)
infra/scripts/restore-db.sh s3://ACT-BACKUPS/act-erp/db/<year>/<file>.dump.gz --keep
# 2. swap names (terminate connections first; needs the postgres superuser)
dc exec postgres psql -U act -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('act','act_restore_test') AND pid <> pg_backend_pid();"
dc exec postgres psql -U act -d postgres -c 'ALTER DATABASE act RENAME TO act_broken_old;'
dc exec postgres psql -U act -d postgres -c 'ALTER DATABASE act_restore_test RENAME TO act;'
dc up -d web
# 3. after a few days of confidence: DROP DATABASE act_broken_old;
```

---

## Security notes

- **Do not `cp Caddyfile.example Caddyfile` on a box that already has a live
  `Caddyfile`.** The live file may contain other sites (the inventory app, etc.)
  and owner-specific blocks; overwriting it takes those sites down and drops their
  certificates' config. Step 3 above is for the **first** install only. For
  later changes, diff and edit by hand (`diff Caddyfile Caddyfile.example`), then
  `dc exec caddy caddy reload --config /etc/caddy/Caddyfile`.
- The Caddyfile adds `Strict-Transport-Security`; the app adds the other
  security headers (`next.config.ts`).
- Timezone: the `web` container runs with `TZ=America/Chicago` (set in the compose
  file and the Dockerfile) and all schedule/punch math uses the explicit business
  timezone helpers (`lib/business-time.ts`). The database stores UTC; do not
  change the Postgres timezone.

## Go-live checklist

- [ ] DNS A record points at the box; `https://<domain>` serves a valid cert
- [ ] `apps/web/.env.prod` filled in (strong `AUTH_SECRET`, DB password matches `postgres.env`, S3 creds, `NEXT_PUBLIC_SITE_URL` = the real public URL, `KIOSK_ALLOWED_NETWORKS`, email provider)
- [ ] `dc run --rm tools prisma db push` succeeded; data scripts in 6b run
- [ ] First admin created **and a second admin** created; both can sign in
- [ ] `curl https://<domain>/api/health` returns `{"status":"ok"}`
- [ ] `dc ps` shows `web` as `healthy`
- [ ] Upload + download a document (proves S3); upload a test paystub
- [ ] Backup bucket + lifecycle + versioning configured; uploads bucket versioning on
- [ ] `backup-db.sh` ran successfully by hand; cron installed; **restore test passed**
- [ ] Kiosk activated from an allowed network; test punch in/out; test a terminated employee cannot punch
- [ ] Email delivery tested (forgot password / onboarding invite)
- [ ] Leave policy reviewed in Admin > Leave; pay periods and job codes set up
- [ ] Box firewall: only 22 (your IP if possible), 80, 443 open; Postgres has **no** published port
- [ ] Automatic snapshots enabled on the instance
- [ ] Sign-out/in test of a read-only (recently terminated) account shows the banner and cannot write

---

## Ongoing operations

- **Deploys:** `git pull && dc up -d --build`. If the release changed
  `schema.prisma`, follow **5b** instead (backup first, then `db push`, then up).
- **Backups:** see "Backups and restore" above. Snapshots + nightly S3 dumps.
- **Health:** `dc ps` (web should be `healthy`); `curl https://<domain>/api/health`.
- **Logs:** `dc logs -f web`; audit-log write failures appear as `[audit] write failed`.

## Cost breakdown (~35 employees)

| Line item | Est. $/month |
|---|--:|
| Lightsail instance (2 vCPU / 2–4 GB) | $10–20 |
| Static IP | included |
| Automatic snapshots | $1–3 |
| S3 (or Lightsail bucket) for documents | $1–3 |
| Domain/DNS (if not already owned) | $0–1 |
| **Total** | **~$15–30/mo (~$180–360/yr)** |

No Bedrock, no Datalab, no SQS, no ALB, no idle Fargate tasks — every dollar
here is either the box itself or storage you're actually using.
