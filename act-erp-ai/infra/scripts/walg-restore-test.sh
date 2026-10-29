#!/usr/bin/env bash
# Non-destructive PITR drill: restore LATEST base backup + WAL into a throwaway
# Docker volume. Never mounts or modifies act-erp-lite_pgdata (live).
#
# Usage:
#   export RESTORE_TO='2026-10-29T16:00:00Z'   # UTC ISO-8601
#   export WALG_RESTORE_ENV_FILE=/path/to/walg-restore.env  # restore IAM (GetObject)
#   ./walg-restore-test.sh [--keep]
#
# Optional: BACKUP_NAME=LATEST (wal-g backup name) or a specific backup.
#
# During promote, wal-g may log missing ".history" WAL object errors. That is often
# benign when recovery finishes (pg_is_in_recovery=f) and the VERIFY queries succeed.
#
# Exit: 0 ok | 1 usage/config | 2 fetch/recovery failed | 3 verification failed
set -euo pipefail
umask 077

log() { printf '%s walg-restore-test: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { local code="$1"; shift; log "ERROR: $*" >&2; exit "$code"; }

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) die 1 "unknown argument: $arg (use --keep or see --help)" ;;
  esac
done

RESTORE_TO="${RESTORE_TO:-}"
[ -n "$RESTORE_TO" ] || die 1 "RESTORE_TO is required (UTC ISO timestamp, e.g. 2026-10-29T16:00:00Z)"

WALG_RESTORE_ENV_FILE="${WALG_RESTORE_ENV_FILE:-}"
[ -n "$WALG_RESTORE_ENV_FILE" ] || die 1 "WALG_RESTORE_ENV_FILE is required (restore IAM creds with GetObject; not backup put-only walg.env)"
[ -f "$WALG_RESTORE_ENV_FILE" ] || die 1 "WALG_RESTORE_ENV_FILE not found: $WALG_RESTORE_ENV_FILE"

# Windows-sourced env files (CRLF) break docker --env-file / wal-g S3 settings.
WALG_RESTORE_ENV_FOR_DOCKER="$(mktemp)"
chmod 600 "$WALG_RESTORE_ENV_FOR_DOCKER"
if grep -q $'\r' "$WALG_RESTORE_ENV_FILE"; then
  log "WALG_RESTORE_ENV_FILE contains CRLF; using LF-normalized copy for docker --env-file"
  tr -d '\r' < "$WALG_RESTORE_ENV_FILE" > "$WALG_RESTORE_ENV_FOR_DOCKER"
else
  cp "$WALG_RESTORE_ENV_FILE" "$WALG_RESTORE_ENV_FOR_DOCKER"
fi

LIVE_VOLUME="${LIVE_PGDATA_VOLUME:-act-erp-lite_pgdata}"
TEST_VOLUME="${RESTORE_TEST_VOLUME:-act-erp-walg-restore-test}"
BACKUP_NAME="${BACKUP_NAME:-LATEST}"
IMAGE="${WALG_POSTGRES_IMAGE:-act-erp-lite-postgres:walg}"

[ "$TEST_VOLUME" != "$LIVE_VOLUME" ] || die 1 "refusing to use live pgdata volume name ($LIVE_VOLUME)"

# Refuse backup-only credentials on the app server.
case "$(readlink -f "$WALG_RESTORE_ENV_FILE" 2>/dev/null || realpath "$WALG_RESTORE_ENV_FILE" 2>/dev/null || echo "$WALG_RESTORE_ENV_FILE")" in
  *"/infra/walg.env") die 1 "WALG_RESTORE_ENV_FILE must not be backup put-only infra/walg.env; use restore IAM env file" ;;
esac

CONTAINER="act-erp-walg-restore-test-$$"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [ "$KEEP" -eq 0 ]; then
    docker volume rm "$TEST_VOLUME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log "target PITR time (UTC): $RESTORE_TO"
log "throwaway volume: $TEST_VOLUME (live volume $LIVE_VOLUME must stay untouched)"

docker volume rm "$TEST_VOLUME" >/dev/null 2>&1 || true
docker volume create "$TEST_VOLUME" >/dev/null

log "backup-fetch $BACKUP_NAME into $TEST_VOLUME"
INNER="$(mktemp)"
cat > "$INNER" <<'INNER_SCRIPT'
set -euo pipefail
DATA=/var/lib/postgresql/data
wal-g backup-fetch "$DATA" "$BACKUP_NAME"
RT_PG="$(date -u -d "$RESTORE_TO" +'%Y-%m-%d %H:%M:%S+00')"
{
  printf "%s\n" "restore_command = 'wal-g wal-fetch %f %p'"
  printf "%s\n" "recovery_target_time = '${RT_PG}'"
  printf "%s\n" "recovery_target_action = 'promote'"
} >> "$DATA/postgresql.auto.conf"
touch "$DATA/recovery.signal"

postgres -D "$DATA" -c listen_addresses= -c port=5432 &
PGPID=$!
trap "kill -TERM $PGPID 2>/dev/null || true" EXIT

deadline=$((SECONDS + 1800))
while [ "$SECONDS" -lt "$deadline" ]; do
  if psql -h /var/run/postgresql -p 5432 -U act -d act -tA -c "SELECT 1" >/dev/null 2>&1; then
    rec="$(psql -h /var/run/postgresql -p 5432 -U act -d act -tA -c "SELECT pg_is_in_recovery()")" || rec=t
    if [ "$rec" = "f" ]; then
      break
    fi
  fi
  sleep 2
done

rec="$(psql -h /var/run/postgresql -p 5432 -U act -d act -tA -c "SELECT pg_is_in_recovery()" 2>/dev/null || echo t)"
[ "$rec" = "f" ] || { echo "recovery did not finish (pg_is_in_recovery=$rec)" >&2; exit 2; }

TE="$(psql -h /var/run/postgresql -p 5432 -U act -d act -tA -c "SELECT count(*) FROM \"TimeEntry\"")"
AUDIT="$(psql -h /var/run/postgresql -p 5432 -U act -d act -tA -c "SELECT coalesce(max(\"createdAt\")::text, 'none') FROM \"AuditLog\"")"
printf "VERIFY TimeEntry=%s newestAuditLog=%s\n" "$TE" "$AUDIT"
kill -TERM "$PGPID" 2>/dev/null || true
wait "$PGPID" 2>/dev/null || true
INNER_SCRIPT
chmod a+r "$INNER"

RUNLOG="$(mktemp)"
trap 'rm -f "$INNER" "$RUNLOG" "$WALG_RESTORE_ENV_FOR_DOCKER"; cleanup' EXIT

if ! docker run --name "$CONTAINER" --entrypoint bash \
  -v "${TEST_VOLUME}:/var/lib/postgresql/data" \
  -v "${INNER}:/tmp/walg-restore-inner.sh:ro" \
  --env-file "$WALG_RESTORE_ENV_FOR_DOCKER" \
  -e "RESTORE_TO=$RESTORE_TO" \
  -e "BACKUP_NAME=$BACKUP_NAME" \
  "$IMAGE" \
  /tmp/walg-restore-inner.sh 2>&1 | tee "$RUNLOG"; then
  die 2 "backup-fetch or PITR recovery failed"
fi

grep '^VERIFY TimeEntry=' "$RUNLOG" | while IFS= read -r line; do log "$line"; done
grep -q '^VERIFY TimeEntry=' "$RUNLOG" || die 3 "verification output missing from restore container"

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
CONTAINER=""

if [ "$KEEP" -eq 1 ]; then
  log "OK — throwaway volume kept: $TEST_VOLUME (docker volume rm $TEST_VOLUME when done)"
else
  docker volume rm "$TEST_VOLUME" >/dev/null
  log "OK — throwaway volume removed"
fi

trap - EXIT
log "OK — live volume $LIVE_VOLUME was not used"
