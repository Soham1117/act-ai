#!/bin/bash
# Deploy an overlay of apps/web files to production, one build at a time.
#
#   deploy-overlay.sh <name> <overlay.tar.gz> [--schema] [--full-check]
#
# <overlay.tar.gz>  tar of files relative to apps/web (e.g. src/..., prisma/...)
# --schema          also run `prisma db push` (builds the tools image too)
# --full-check      keep the TypeScript check inside the server build. By default it
#                   is skipped to save about a minute, so run `tsc --noEmit` locally
#                   before you ship the overlay.
#
# Safety: one deploy at a time (lock), refuses to start while any other deploy or
# docker build is running or memory is low, backs up the database first, builds,
# starts the new image next to the old one, and only switches after it answers.
set -euo pipefail

NAME=${1:?usage: deploy-overlay.sh <name> <overlay.tar.gz> [--schema] [--full-check]}
OVERLAY=${2:?missing overlay tarball}
shift 2
SCHEMA=0
SKIP_TYPECHECK=1
for arg in "$@"; do
  case "$arg" in
    --schema) SCHEMA=1 ;;
    --full-check) SKIP_TYPECHECK=0 ;;
    *) echo "unknown option $arg"; exit 2 ;;
  esac
done

export PATH="/home/ubuntu/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
exec 9>/tmp/act-deploy.lock
flock -n 9 || { echo "ABORT: another deploy holds /tmp/act-deploy.lock"; exit 1; }
# Other people's scripts do not take the lock, so also look for their processes.
OTHERS=$(pgrep -f '_deploy-.*\.sh|docker-buildx|compose.* build|buildx prune' | grep -vx "$$" || true)
if [ -n "$OTHERS" ]; then echo "ABORT: another deploy or build is running (pids: $(echo $OTHERS | tr '\n' ' '))"; exit 1; fi
AVAIL_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
echo "MemAvailable=${AVAIL_MB}MB"
[ "$AVAIL_MB" -ge 3500 ] || { echo "ABORT: need at least 3500MB available memory"; exit 1; }
test -f "$OVERLAY" || { echo "ABORT: $OVERLAY not found"; exit 1; }

ROOT=/home/ubuntu/act-erp-ai/act-erp-ai
WEB=$ROOT/apps/web
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RELEASE=/home/ubuntu/act-releases/$NAME-$STAMP
mkdir -m 700 -p "$RELEASE"
COMPOSE=(docker compose -f "$ROOT/infra/docker-compose.prod-lite.yml")
CANDIDATE_TAG="act-erp-lite-web:$NAME-$STAMP"
WARM_NAME="act-persona-$NAME-warm"
START=$(date +%s)
lap() { echo "[$(( $(date +%s) - START ))s] $*"; }

cd "$ROOT"
echo "RELEASE=$RELEASE"
"${COMPOSE[@]}" exec -T postgres pg_dump -U act -d act -Fc > "$RELEASE/database-before.dump"
lap "database backup done"

cp -a "$WEB/.env.prod" "$RELEASE/env.prod.before"
tar -C "$WEB" -xzf "$OVERLAY"
cp -a "$RELEASE/env.prod.before" "$WEB/.env.prod"
tar -tzf "$OVERLAY" | head -30
PREV=$(docker inspect act-erp-lite-web-1 --format '{{.Image}}')
echo "$PREV" > "$RELEASE/previous-image.txt"
docker tag "$PREV" "act-erp-lite-web:before-$NAME-$STAMP" || true

TARGETS=(web)
[ "$SCHEMA" = 1 ] && TARGETS=(web tools)
"${COMPOSE[@]}" build --build-arg "SKIP_TYPECHECK=$SKIP_TYPECHECK" "${TARGETS[@]}" > "$RELEASE/build-web.log" 2>&1 \
  || { tail -30 "$RELEASE/build-web.log"; echo BUILD_FAILED; exit 1; }
lap "build done (${TARGETS[*]}, skip typecheck=$SKIP_TYPECHECK)"
docker tag act-erp-lite-web:latest "$CANDIDATE_TAG"
docker image inspect "$CANDIDATE_TAG" --format '{{.Id}}' | tee "$RELEASE/candidate-image.txt"

if [ "$SCHEMA" = 1 ]; then
  "${COMPOSE[@]}" --profile tools run --rm tools prisma db push 2>&1 | tee "$RELEASE/db-push.log"
  lap "schema push done"
fi

docker rm -f "$WARM_NAME" >/dev/null 2>&1 || true
docker run -d --name "$WARM_NAME" --network act-erp-lite_default \
  --env-file "$WEB/.env.prod" -e HOSTNAME=0.0.0.0 -e TZ=America/Chicago \
  "$CANDIDATE_TAG" >"$RELEASE/warm-container.txt"
ok=0
for i in $(seq 1 60); do
  if docker exec "$WARM_NAME" node -e "Promise.all(['/api/health','/login'].map(async p=>{const r=await fetch('http://127.0.0.1:3000'+p); if(r.status!==200) throw new Error(p+' '+r.status); if(p==='/api/health' && (await r.json()).status!=='ok') throw new Error('health');})).then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1)})" 2>/dev/null; then
    ok=1; break
  fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  docker logs "$WARM_NAME" >"$RELEASE/warm-failed.log" 2>&1 || true
  docker rm -f "$WARM_NAME" >/dev/null 2>&1 || true
  echo WARM_FAILED; exit 1
fi
lap "new image answers"

docker tag "$CANDIDATE_TAG" act-erp-lite-web:latest
"${COMPOSE[@]}" up -d --no-deps --no-build --force-recreate web >"$RELEASE/switch.log" 2>&1
for i in $(seq 1 40); do
  st=$(docker inspect act-erp-lite-web-1 --format '{{.State.Health.Status}}')
  [ "$st" = healthy ] && break
  sleep 2
done
st=$(docker inspect act-erp-lite-web-1 --format '{{.State.Health.Status}}')
echo "health=$st"
[ "$st" = healthy ]
for path in /api/health /login; do
  code=$(curl --retry 3 --retry-delay 2 --connect-timeout 5 --max-time 20 -sS -o /dev/null -w '%{http_code}' "https://persona.americancompletiontools.com$path")
  echo "$path=$code"
  [ "$code" = 200 ]
done
docker rm -f "$WARM_NAME" >/dev/null 2>&1 || true
lap "switched"
echo "{\"status\":\"deployed\",\"release\":\"$RELEASE\",\"stamp\":\"$STAMP\"}" | tee "$RELEASE/release-result.json"
echo DEPLOY_OK
