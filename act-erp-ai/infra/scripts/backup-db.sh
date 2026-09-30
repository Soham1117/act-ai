#!/usr/bin/env bash
# Nightly Postgres backup -> S3.
#
#   pg_dump -Fc (inside the compose postgres container) -> gzip -> aws s3 cp
#
# Usage (on the box, from anywhere):
#   BACKUP_S3_URI=s3://my-backup-bucket/act-erp ./backup-db.sh
#
# Environment:
#   BACKUP_S3_URI   required. s3://bucket[/prefix]  (use a DIFFERENT bucket than uploads,
#                   with versioning + lifecycle; see infra/aws/DEPLOY-LITE.md "Backups")
#   COMPOSE_FILE    default: <this dir>/../docker-compose.prod-lite.yml
#   AWS_PROFILE / AWS_* / instance profile: standard AWS CLI credential chain (never logged)
#   BACKUP_KEEP_LOCAL_DIR  optional. Also keep the newest dump here (chmod 600).
#
# Exit codes: 0 ok | 1 config/usage | 2 pg_dump failed | 3 dump failed verification
#             | 4 upload failed | 5 another backup is already running
# Retention is handled by the S3 lifecycle rule, not by this script.
set -euo pipefail
umask 077

log() { printf '%s backup-db: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { local code="$1"; shift; log "ERROR: $*" >&2; exit "$code"; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$HERE/../docker-compose.prod-lite.yml}"
[ -n "${BACKUP_S3_URI:-}" ] || die 1 "BACKUP_S3_URI is not set (e.g. s3://my-backup-bucket/act-erp)"
[ -f "$COMPOSE_FILE" ] || die 1 "compose file not found: $COMPOSE_FILE"
command -v aws >/dev/null 2>&1 || die 1 "aws CLI not installed"
command -v docker >/dev/null 2>&1 || die 1 "docker not installed"
command -v gzip >/dev/null 2>&1 || die 1 "gzip not installed"

# One backup at a time (cron overlap / manual run while cron fires).
exec 9>"${TMPDIR:-/tmp}/act-erp-backup.lock"
flock -n 9 || die 5 "another backup is running"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
YEAR="$(date -u +%Y)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/act-$STAMP.dump.gz"
DC=(docker compose -f "$COMPOSE_FILE")

log "dumping database"
# -Z 0: custom format uncompressed so gzip (outer) does the compression once.
# Credentials come from the container's own POSTGRES_* env; nothing secret on the command line.
if ! "${DC[@]}" exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 0' \
     | gzip -9 > "$OUT"; then
  die 2 "pg_dump failed"
fi
# pipefail covers the pipeline; also guard against an empty/truncated file.
SIZE="$(stat -c %s "$OUT")"
[ "$SIZE" -gt 1024 ] || die 3 "dump is suspiciously small (${SIZE} bytes)"

log "verifying archive (pg_restore --list)"
if ! gzip -dc "$OUT" | "${DC[@]}" exec -T postgres pg_restore --list >/dev/null; then
  die 3 "dump failed pg_restore --list verification"
fi

DEST="${BACKUP_S3_URI%/}/db/$YEAR/act-$STAMP.dump.gz"
log "uploading ${SIZE} bytes to $DEST"
if ! aws s3 cp "$OUT" "$DEST" --only-show-errors --sse AES256; then
  die 4 "upload to S3 failed"
fi

if [ -n "${BACKUP_KEEP_LOCAL_DIR:-}" ]; then
  mkdir -p "$BACKUP_KEEP_LOCAL_DIR"
  cp "$OUT" "$BACKUP_KEEP_LOCAL_DIR/latest.dump.gz"
  chmod 600 "$BACKUP_KEEP_LOCAL_DIR/latest.dump.gz"
fi

log "OK $DEST"
