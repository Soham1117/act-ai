# WAL-G point-in-time recovery (Postgres on Lightsail)

Operational runbook for continuous archiving and restore. Tasks are numbered in the implementation plan.

## Bucket and IAM (Task 1)

| Item | Value |
|------|--------|
| **Bucket** | `act-persona-db-backups` (`us-east-2`) |
| **WAL-G prefix** | `s3://act-persona-db-backups/act-erp/wal-g` |
| **Object Lock** | Enabled at bucket creation; default **GOVERNANCE** retention **30 days** |
| **Versioning** | Enabled (required for Object Lock) |
| **Public access** | Blocked (all four public-access-block flags) |
| **Lifecycle** | Abort incomplete multipart uploads under `act-erp/wal-g/` after 3 days (`walg-bucket-lifecycle.json`) |

### IAM users

| User | Purpose | Policy file | Credentials location |
|------|---------|-------------|----------------------|
| `act-persona-walg-backup` | WAL-G upload only (`PutObject`, multipart helpers, scoped `ListBucket`) | `walg-backup-put-policy.json` | `/home/ubuntu/act-erp-ai/act-erp-ai/infra/walg.env` on the Lightsail box (`chmod 600`) |
| `act-persona-walg-restore` | Offline restore/read; optional governance-bypass delete for emergency prune | `walg-restore-policy.json` | Password manager; for **drills only** copy to `infra/walg-restore.env` on Lightsail (`chmod 600`), remove after success when possible — never commit |

**App isolation:** The web app and its IAM user / `.env.prod` S3 credentials must **never** be granted access to `act-persona-db-backups`. Document uploads use a separate bucket. Do not put WAL-G keys in `apps/web/.env.prod`.

### Create or reconcile (admin AWS credentials)

Bucket (Object Lock must be enabled at create time):

```bash
BUCKET=act-persona-db-backups
REGION=us-east-2

aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" \
  --object-lock-enabled-for-bucket

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-object-lock-configuration --bucket "$BUCKET" \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {
      "DefaultRetention": {
        "Mode": "GOVERNANCE",
        "Days": 30
      }
    }
  }'

aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration file://act-erp-ai/infra/aws/walg-bucket-lifecycle.json
```

Backup user:

```bash
aws iam create-user --user-name act-persona-walg-backup
aws iam put-user-policy --user-name act-persona-walg-backup \
  --policy-name act-persona-walg-put \
  --policy-document file://act-erp-ai/infra/aws/walg-backup-put-policy.json
aws iam create-access-key --user-name act-persona-walg-backup
# Store key material only in infra/walg.env on the server (see table above).
```

Restore user (offline keys):

```bash
aws iam create-user --user-name act-persona-walg-restore
aws iam put-user-policy --user-name act-persona-walg-restore \
  --policy-name act-persona-walg-restore \
  --policy-document file://act-erp-ai/infra/aws/walg-restore-policy.json
aws iam create-access-key --user-name act-persona-walg-restore
# Save in a password manager; do not deploy to Lightsail.
```

Verify Object Lock: `aws s3api get-object-lock-configuration --bucket act-persona-db-backups`

Verify put-only backup user: `PutObject` to `act-erp/wal-g/*` succeeds; `GetObject` returns `AccessDenied`.

---

## Ops cadence (Task 4)

### Scheduled base backup

Example crontab for the `ubuntu` user on Lightsail: `infra/scripts/walg.cron.example`.

```bash
sudo touch /var/log/act-erp-walg-backup.log
sudo chown ubuntu:ubuntu /var/log/act-erp-walg-backup.log
crontab -e   # paste the example schedule (CRON_TZ=America/Chicago, daily 05:15)
```

After install, run once manually and confirm the log ends with `walg-backup: OK`:

```bash
/home/ubuntu/act-erp-ai/act-erp-ai/infra/scripts/walg-backup-push.sh >> /var/log/act-erp-walg-backup.log 2>&1
tail -3 /var/log/act-erp-walg-backup.log
```

If backups fail, page ops (email or a healthchecks.io ping wrapping the cron command).

### Archive lag / archiver health

Weekly (or after any backup alert), check the archiver stats. **`failed_count` must stay at 0.** If it rises, treat as incident: fix archiving before relying on PITR.

From the repo root on the server (`/home/ubuntu/act-erp-ai/act-erp-ai`):

```bash
docker compose -f infra/docker-compose.prod-lite.yml exec -T postgres \
  psql -U act -d act -c "SELECT archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_wal FROM pg_stat_archiver;"
```

Optional weekly cron (same user as backup):

```cron
CRON_TZ=America/Chicago
0 6 * * 1 docker compose -f /home/ubuntu/act-erp-ai/act-erp-ai/infra/docker-compose.prod-lite.yml exec -T postgres psql -U act -d act -c "SELECT archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_wal FROM pg_stat_archiver;" >> /var/log/act-erp-walg-archive-check.log 2>&1
```

### Monthly restore drill

Run `infra/scripts/walg-restore-test.sh` on the **first Monday of each month**; keep logs under `/home/ubuntu/act-releases/walg-drill-*/`. Document the release directory path in this file under **Acceptance** (no secrets).

```bash
RELEASE=/home/ubuntu/act-releases/walg-drill-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$RELEASE"
export RESTORE_TO="$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"
export WALG_RESTORE_ENV_FILE=/home/ubuntu/act-erp-ai/act-erp-ai/infra/walg-restore.env
# Restore IAM env only (GetObject); do not point at infra/walg.env (put-only backup user).
/home/ubuntu/act-erp-ai/act-erp-ai/infra/scripts/walg-restore-test.sh | tee "$RELEASE/walg-restore-test.log"
curl -fsS https://persona.americancompletiontools.com/api/health
# Prefer: rm -f "$WALG_RESTORE_ENV_FILE" after a successful drill
```

## Disaster cutover (Task 6)

Use only when the live database is corrupt or wiped and you have already run
`walg-restore-test.sh` successfully at the **same** `RESTORE_TO` (or you accept
the risk without a drill).

**Script:** `infra/scripts/walg-disaster-restore.sh`

**Required environment:**

| Variable | Value |
|----------|--------|
| `I_UNDERSTAND_THIS_REPLACES_LIVE_DB` | `yes` |
| `RESTORE_TO` | UTC ISO timestamp (same as drill), e.g. `2026-10-29T16:00:00Z` |
| `WALG_RESTORE_ENV_FILE` | Restore IAM env on the box (`GetObject`); never `infra/walg.env` |

**What it does (in order):**

1. `docker compose stop web`
2. Best-effort `pg_dump` → `/home/ubuntu/act-releases/walg-disaster-<stamp>/last-chance.dump`
3. `docker compose stop postgres`
4. **Volume aside:** copy `act-erp-lite_pgdata` → `act-erp-lite_pgdata-broken-<stamp>`, clear live `pgdata`, then `wal-g backup-fetch` + PITR into live `pgdata`
5. `docker compose up -d postgres` — verify `TimeEntry` / `AuditLog` counts
6. `docker compose up -d web` — `curl` public `/api/health`

**Broken volume:** kept for manual rollback inspection. After **7 days** (override with `BROKEN_KEEP_DAYS`) of confidence, an operator removes it explicitly:

```bash
docker volume rm act-erp-lite_pgdata-broken-<stamp>
```

The script never auto-deletes the broken volume or release logs.

Example (maintenance window; restore creds on box only for the run):

```bash
export I_UNDERSTAND_THIS_REPLACES_LIVE_DB=yes
export RESTORE_TO='2026-10-29T16:00:00Z'
export WALG_RESTORE_ENV_FILE=/home/ubuntu/act-erp-ai/act-erp-ai/infra/walg-restore.env
/home/ubuntu/act-erp-ai/act-erp-ai/infra/scripts/walg-disaster-restore.sh | tee /home/ubuntu/act-releases/walg-disaster-$(date -u +%Y%m%dT%H%M%SZ)/run.log
# Prefer: rm -f "$WALG_RESTORE_ENV_FILE" after success when possible
```

---

## Acceptance (Task 5)

First non-destructive drill (2026-10-29): `/home/ubuntu/act-releases/walg-drill-20261029T163548Z/walg-restore-test.log` — exit 0; `TimeEntry=105`; live `/api/health` ok. Restore IAM env was removed from the box after the run.

When building `walg-restore.env` from an operator import file, strip CRLF (`sed 's/\r$//'`) before `docker --env-file` or wal-g will not see S3 storage.
