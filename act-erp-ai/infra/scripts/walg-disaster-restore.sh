#!/usr/bin/env bash
# LIVE disaster cutover: replaces act-erp-lite_pgdata via WAL-G PITR.
# Run only after a successful walg-restore-test.sh at the same RESTORE_TO.
#
# Usage:
#   export I_UNDERSTAND_THIS_REPLACES_LIVE_DB=yes
#   export RESTORE_TO='2026-10-29T16:00:00Z'
#   export WALG_RESTORE_ENV_FILE=/path/to/walg-restore.env
#   ./walg-disaster-restore.sh
#
# Optional: BACKUP_NAME=LATEST, BROKEN_KEEP_DAYS=7, HEALTH_URL=https://.../api/health
#
# Exit: 0 ok | 1 usage/config | 2 fetch/recovery failed | 3 verification failed | 4 health failed
set -euo pipefail
umask 077
export PATH="/home/ubuntu/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

log() { printf '%s walg-disaster-restore: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { local code="$1"; shift; log "ERROR: $*" >&2; exit "$code"; }

[ "${I_UNDERSTAND_THIS_REPLACES_LIVE_DB:-}" = "yes" ] \
  || die 1 "refusing to run: set I_UNDERSTAND_THIS_REPLACES_LIVE_DB=yes"

RESTORE_TO="${RESTORE_TO:-}"
[ -n "$RESTORE_TO" ] || die 1 "RESTORE_TO is required (UTC ISO timestamp, e.g. 2026-10-29T16:00:00Z)"

WALG_RESTORE_ENV_FILE="${WALG_RESTORE_ENV_FILE:-}"
[ -n "$WALG_RESTORE_ENV_FILE" ] || die 1 "WALG_RESTORE_ENV_FILE is required (restore IAM with GetObject; not backup put-only walg.env)"
[ -f "$WALG_RESTORE_ENV_FILE" ] || die 1 "WALG_RESTORE_ENV_FILE not found: $WALG_RESTORE_ENV_FILE"

case "$(readlink -f "$WALG_RESTORE_ENV_FILE" 2>/dev/null || realpath "$WALG_RESTORE_ENV_FILE" 2>/dev/null || echo "$WALG_RESTORE_ENV_FILE")" in
  *"/infra/walg.env") die 1 "WALG_RESTORE_ENV_FILE must not be backup put-only infra/walg.env" ;;
esac

WALG_RESTORE_ENV_FOR_DOCKER="$(mktemp)"
chmod 600 "$WALG_RESTORE_ENV_FOR_DOCKER"
if grep -q $'\r' "$WALG_RESTORE_ENV_FILE"; then
  log "WALG_RESTORE_ENV_FILE contains CRLF; using LF-normalized copy for docker --env-file"
  tr -d '\r' < "$WALG_RESTORE_ENV_FILE" > "$WALG_RESTORE_ENV_FOR_DOCKER"
else
  cp "$WALG_RESTORE_ENV_FILE" "$WALG_RESTORE_ENV_FOR_DOCKER"
fi

ROOT="${ACT_ERP_ROOT:-/home/ubuntu/act-erp-ai/act-erp-ai}"
COMPOSE=(docker compose -f "$ROOT/infra/docker-compose.prod-lite.yml")
LIVE_VOLUME="${LIVE_PGDATA_VOLUME:-act-erp-lite_pgdata}"
BACKUP_NAME="${BACKUP_NAME:-LATEST}"
IMAGE="${WALG_POSTGRES_IMAGE:-act-erp-lite-postgres:walg}"
BROKEN_KEEP_DAYS="${BROKEN_KEEP_DAYS:-7}"
HEALTH_URL="${HEALTH_URL:-https://persona.americancompletiontools.com/api/health}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BROKEN_VOLUME="${LIVE_VOLUME}-broken-${STAMP}"
RELEASE="/home/ubuntu/act-releases/walg-disaster-${STAMP}"
DUMP_PATH="${RELEASE}/last-chance.dump"

[ -d "$ROOT" ] || die 1 "ACT_ERP_ROOT not found: $ROOT"
mkdir -p "$RELEASE"
chmod 700 "$RELEASE"

log "DISASTER CUTOVER — PITR target (UTC): $RESTORE_TO"
log "release dir: $RELEASE"
log "live pgdata volume: $LIVE_VOLUME → aside as $BROKEN_VOLUME after copy"

cd "$ROOT"

log "stopping web (no app writes during cutover)"
"${COMPOSE[@]}" stop web

log "best-effort pg_dump of live DB → $DUMP_PATH"
if "${COMPOSE[@]}" exec -T postgres pg_isready -U act -d act >/dev/null 2>&1; then
  if ! "${COMPOSE[@]}" exec -T postgres pg_dump -U act -d act -Fc > "$DUMP_PATH" 2>"${RELEASE}/last-chance.dump.err"; then
    log "WARN: pg_dump failed (see ${RELEASE}/last-chance.dump.err); continuing with WAL-G PITR"
    rm -f "$DUMP_PATH"
  else
    log "pg_dump OK ($(wc -c < "$DUMP_PATH") bytes)"
  fi
else
  log "WARN: postgres not accepting connections; skipping pg_dump"
fi

log "stopping postgres"
"${COMPOSE[@]}" stop postgres

if ! docker volume inspect "$LIVE_VOLUME" >/dev/null 2>&1; then
  die 1 "live volume not found: $LIVE_VOLUME"
fi

log "copy $LIVE_VOLUME → $BROKEN_VOLUME (broken copy kept for rollback inspection)"
docker volume rm "$BROKEN_VOLUME" >/dev/null 2>&1 || true
docker volume create "$BROKEN_VOLUME" >/dev/null
docker run --rm \
  -v "${LIVE_VOLUME}:/from:ro" \
  -v "${BROKEN_VOLUME}:/to" \
  alpine:3.20 sh -c 'cp -a /from/. /to/'

log "clear live volume for fresh backup-fetch"
docker run --rm -v "${LIVE_VOLUME}:/data" alpine:3.20 sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +'

CONTAINER="act-erp-walg-disaster-recover-$$"
cleanup_container() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap 'rm -f "$INNER" "$RUNLOG" "$WALG_RESTORE_ENV_FOR_DOCKER"; cleanup_container' EXIT

log "backup-fetch $BACKUP_NAME + PITR into $LIVE_VOLUME"
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

deadline=$((SECONDS + 3600))
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

RUNLOG="${RELEASE}/walg-disaster-recover.log"
if ! docker run --name "$CONTAINER" --entrypoint bash \
  -v "${LIVE_VOLUME}:/var/lib/postgresql/data" \
  -v "${INNER}:/tmp/walg-disaster-inner.sh:ro" \
  --env-file "$WALG_RESTORE_ENV_FOR_DOCKER" \
  -e "RESTORE_TO=$RESTORE_TO" \
  -e "BACKUP_NAME=$BACKUP_NAME" \
  "$IMAGE" \
  /tmp/walg-disaster-inner.sh 2>&1 | tee "$RUNLOG"; then
  die 2 "backup-fetch or PITR recovery failed — broken copy remains at docker volume $BROKEN_VOLUME"
fi

grep '^VERIFY TimeEntry=' "$RUNLOG" | while IFS= read -r line; do log "$line"; done
grep -q '^VERIFY TimeEntry=' "$RUNLOG" || die 3 "verification output missing from recovery container"

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
CONTAINER=""

log "starting postgres via compose"
"${COMPOSE[@]}" up -d postgres
deadline=$((SECONDS + 120))
while [ "$SECONDS" -lt "$deadline" ]; do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U act -d act >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
"${COMPOSE[@]}" exec -T postgres pg_isready -U act -d act >/dev/null 2>&1 \
  || die 3 "postgres did not become ready after compose up"

TE="$("${COMPOSE[@]}" exec -T postgres psql -U act -d act -tA -c 'SELECT count(*) FROM "TimeEntry"')"
AUDIT="$("${COMPOSE[@]}" exec -T postgres psql -U act -d act -tA -c 'SELECT coalesce(max("createdAt")::text, '\''none'\'') FROM "AuditLog"')"
log "live VERIFY TimeEntry=$TE newestAuditLog=$AUDIT"

log "starting web"
"${COMPOSE[@]}" up -d web

health_deadline=$((SECONDS + 180))
while [ "$SECONDS" -lt "$health_deadline" ]; do
  if curl -fsS "$HEALTH_URL" | grep -q '"status":"ok"'; then
    log "health OK: $HEALTH_URL"
    log "OK — disaster cutover complete"
    log "REMINDER: after ${BROKEN_KEEP_DAYS} days of confidence, drop the broken volume manually:"
    log "  docker volume rm ${BROKEN_VOLUME}"
    log "(do not auto-delete; broken data and release logs stay under ${RELEASE})"
    trap - EXIT
    exit 0
  fi
  sleep 5
done

die 4 "health check failed: $HEALTH_URL (postgres may be up; inspect web logs)"
