#!/usr/bin/env bash
# Restore a backup into a SCRATCH database to prove it works. Never touches the
# live database.
#
# Usage:
#   ./restore-db.sh s3://bucket/act-erp/db/2026/act-20260930T020000Z.dump.gz [--keep]
#   ./restore-db.sh /path/to/act-....dump.gz [--keep]
#
#   Scratch DB name: act_restore_test (override with SCRATCH_DB). It is dropped
#   and recreated each run, and dropped again at the end unless --keep is given.
#
# Environment: COMPOSE_FILE (default ../docker-compose.prod-lite.yml), AWS creds for s3:// sources.
# Exit codes: 0 ok | 1 usage/config | 2 download failed | 3 restore failed | 4 sanity check failed
#
# Restoring INTO the live database (disaster recovery) is deliberately manual;
# see "Restore" in infra/aws/DEPLOY-LITE.md.
set -euo pipefail
umask 077

log() { printf '%s restore-db: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { local code="$1"; shift; log "ERROR: $*" >&2; exit "$code"; }

SRC="${1:-}"
KEEP=0
[ "${2:-}" = "--keep" ] && KEEP=1
[ -n "$SRC" ] || die 1 "usage: $0 <s3://...dump.gz | local.dump.gz> [--keep]"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$HERE/../docker-compose.prod-lite.yml}"
SCRATCH_DB="${SCRATCH_DB:-act_restore_test}"
[ -f "$COMPOSE_FILE" ] || die 1 "compose file not found: $COMPOSE_FILE"
DC=(docker compose -f "$COMPOSE_FILE")

case "$SCRATCH_DB" in
  *[!a-zA-Z0-9_]*) die 1 "SCRATCH_DB may only contain letters, digits, underscore" ;;
esac
# Refuse to run against the live DB name.
LIVE_DB="$("${DC[@]}" exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')"
[ "$SCRATCH_DB" != "$LIVE_DB" ] || die 1 "SCRATCH_DB must not equal the live database ($LIVE_DB)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FILE="$WORK/restore.dump.gz"
case "$SRC" in
  s3://*)
    command -v aws >/dev/null 2>&1 || die 1 "aws CLI not installed"
    log "downloading $SRC"
    aws s3 cp "$SRC" "$FILE" --only-show-errors || die 2 "download failed"
    ;;
  *)
    [ -f "$SRC" ] || die 1 "file not found: $SRC"
    cp "$SRC" "$FILE"
    ;;
esac

# SQL is passed on stdin so quoting of "User" etc. stays trivial.
psql_admin() { printf '%s\n' "$1" | "${DC[@]}" exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -tA'; }
psql_scratch() { printf '%s\n' "$1" | "${DC[@]}" exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d $SCRATCH_DB -tA"; }

log "recreating scratch database $SCRATCH_DB"
psql_admin "DROP DATABASE IF EXISTS $SCRATCH_DB" >/dev/null
psql_admin "CREATE DATABASE $SCRATCH_DB" >/dev/null

log "restoring"
# --no-owner/--no-acl: a scratch restore only needs the data. Extensions (vector, pg_trgm) are in the dump.
if ! gzip -dc "$FILE" | "${DC[@]}" exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH_DB --no-owner --no-acl --exit-on-error"; then
  die 3 "pg_restore failed"
fi

log "sanity checks"
USERS="$(psql_scratch 'SELECT count(*) FROM "User"')" || die 4 "cannot query User"
EMPS="$(psql_scratch 'SELECT count(*) FROM "Employee"')" || die 4 "cannot query Employee"
TES="$(psql_scratch 'SELECT count(*) FROM "TimeEntry"')" || die 4 "cannot query TimeEntry"
LAST="$(psql_scratch 'SELECT coalesce(max("createdAt")::text, $$none$$) FROM "AuditLog"')" || die 4 "cannot query AuditLog"
log "Users=$USERS Employees=$EMPS TimeEntries=$TES newestAuditLog=$LAST"
[ "${USERS:-0}" -gt 0 ] || die 4 "restored database has no users - backup looks empty"

if [ "$KEEP" -eq 1 ]; then
  log "OK - scratch database kept: $SCRATCH_DB (drop it when done: DROP DATABASE $SCRATCH_DB)"
else
  psql_admin "DROP DATABASE $SCRATCH_DB" >/dev/null
  log "OK - scratch database dropped"
fi
