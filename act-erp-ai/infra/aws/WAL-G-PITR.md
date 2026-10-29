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
| `act-persona-walg-restore` | Offline restore/read; optional governance-bypass delete for emergency prune | `walg-restore-policy.json` | Password manager only — **not** on the app server |

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
  --lifecycle-configuration file://infra/aws/walg-bucket-lifecycle.json
```

Backup user:

```bash
aws iam create-user --user-name act-persona-walg-backup
aws iam put-user-policy --user-name act-persona-walg-backup \
  --policy-name act-persona-walg-put \
  --policy-document file://infra/aws/walg-backup-put-policy.json
aws iam create-access-key --user-name act-persona-walg-backup
# Store key material only in infra/walg.env on the server (see table above).
```

Restore user (offline keys):

```bash
aws iam create-user --user-name act-persona-walg-restore
aws iam put-user-policy --user-name act-persona-walg-restore \
  --policy-name act-persona-walg-restore \
  --policy-document file://infra/aws/walg-restore-policy.json
aws iam create-access-key --user-name act-persona-walg-restore
# Save in a password manager; do not deploy to Lightsail.
```

Verify Object Lock: `aws s3api get-object-lock-configuration --bucket act-persona-db-backups`

Verify put-only backup user: `PutObject` to `act-erp/wal-g/*` succeeds; `GetObject` returns `AccessDenied`.

---

## Later tasks

Postgres `archive_mode`, WAL-G in Docker, base backup schedule, and restore drills are documented in subsequent plan tasks.
