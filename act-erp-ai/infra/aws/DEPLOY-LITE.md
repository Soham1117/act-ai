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
cp Caddyfile.example Caddyfile                # set your real domain
cp ../apps/web/.env.prod-lite.example ../apps/web/.env.prod
# edit apps/web/.env.prod: DATABASE_URL/DIRECT_URL password (match postgres.env),
# AUTH_SECRET (openssl rand -base64 32), S3 creds, NEXT_PUBLIC_SITE_URL
```

## 4. Point DNS at the box

A record for your domain/subdomain → the static IP. Caddy handles the TLS
cert automatically on first request once DNS resolves (needs 80 and 443
reachable from the internet for the ACME challenge).

## 5. Bring it up

```bash
docker compose -f docker-compose.prod-lite.yml up -d --build
```

First boot: `web`'s container needs the schema in place before it's useful.
The standalone Docker image doesn't bundle the Prisma CLI (only what
`next start` needs at runtime), so run the migration from your own machine
against the box's Postgres over an SSH tunnel instead:

```bash
# On the box, once: temporarily bind postgres to localhost only (not 0.0.0.0)
# so it's reachable via SSH forwarding but never exposed to the internet.
# Add under the postgres service in docker-compose.prod-lite.yml:
#   ports:
#     - "127.0.0.1:5432:5432"
# then: docker compose -f docker-compose.prod-lite.yml up -d postgres

# From your laptop:
ssh -N -L 5433:localhost:5432 ubuntu@<static-ip> &
# in apps/web/, with DATABASE_URL/DIRECT_URL pointed at
# postgresql://act:<password>@localhost:5433/act (a throwaway .env.migrate):
pnpm exec dotenv -e .env.migrate -- prisma db push
kill %1   # close the tunnel when done
```

(The `01_rag_pgvector_rls.sql` migration is **not** needed for this deploy —
it only sets up the vector/RLS objects the AI feature uses.)

Afterward, remove the `ports:` line you added to the `postgres` service and
`docker compose up -d postgres` again — Postgres has no reason to be
reachable from outside the box day-to-day.

## 6. Create the first admin

With the same SSH tunnel from step 5 still open, from your laptop:

```bash
pnpm tsx --env-file=.env.migrate scripts/create-admin.ts you@company.com 'StrongPass#1' 'Your Name'
```

## 7. Smoke test

Visit `https://your-domain`, log in, click through Employees / Payroll /
Documents. Confirm file upload+download round-trips (proves S3 creds work).

---

## Ongoing operations

- **Deploys:** `git pull && docker compose -f docker-compose.prod-lite.yml up -d --build`
- **Backups:** enable Lightsail automatic snapshots (~$1–3/mo depending on
  disk size) for the whole instance — covers the Postgres data volume. For
  belt-and-suspenders, add a cron `pg_dump` to S3 as well.
- **Logs:** `docker compose -f docker-compose.prod-lite.yml logs -f web`

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
