#!/usr/bin/env bash
# Daily WAL-G base backup + retain 30 days of full backups.
set -euo pipefail
umask 077
export PATH="/home/ubuntu/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ROOT=/home/ubuntu/act-erp-ai/act-erp-ai
COMPOSE=(docker compose -f "$ROOT/infra/docker-compose.prod-lite.yml")
log() { printf '%s walg-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

cd "$ROOT"
log "backup-push"
"${COMPOSE[@]}" exec -T postgres wal-g backup-push /var/lib/postgresql/data
log "delete retain FULL 30"
"${COMPOSE[@]}" exec -T postgres wal-g delete retain FULL 30 --confirm || log "WARN: delete skipped (Object Lock or empty history)"
log "OK"
