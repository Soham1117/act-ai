#!/bin/bash
# The one deploy script. Run it from your PC (Git Bash) at the repo root.
#
#   infra/scripts/deploy.sh [--schema] [--warm] [--backup|--no-backup] [--allow-dirty] [--full-check]
#
# What it does:
#   1. Builds the web image on THIS machine from the committed code (git HEAD),
#      so the small prod server never builds. Type check runs here first.
#   2. Ships the image over SSH (gzip) and loads it on the server.
#   3. On the server (one deploy at a time): optional DB backup, optional schema
#      push, optional warm check, switch, health check, and automatic rollback to
#      the previous image if the new one is not healthy.
#
# Flags
#   --schema       also ship the `tools` image and run `prisma db push` (additive changes).
#                  Turns the database backup on by default.
#   --backup       force a pg_dump before deploying.   --no-backup  skip it.
#                  Default: backup only with --schema (nightly + WAL backups exist).
#   --warm         start the new image next to the old one and test it before switching.
#                  Use for risky changes. Default: switch, then verify and roll back.
#   --allow-dirty  build HEAD even if tracked files in apps/web have uncommitted edits
#                  (those edits are NOT shipped; only committed code is).
#   --full-check   keep the type check inside the image build too.
set -euo pipefail

HOST=${DEPLOY_HOST:-ubuntu@3.134.179.142}
KEY=${DEPLOY_KEY:-"D:/Deployed Projects/LightsailDefaultKey-us-east-2.pem"}
SITE=${DEPLOY_SITE:-https://persona.americancompletiontools.com}
REMOTE_ROOT=/home/ubuntu/act-erp-ai/act-erp-ai

SCHEMA=0; WARM=0; BACKUP=auto; DIRTY=0; SKIP_TYPECHECK=1
for arg in "$@"; do
  case "$arg" in
    --schema) SCHEMA=1 ;;
    --warm) WARM=1 ;;
    --backup) BACKUP=1 ;;
    --no-backup) BACKUP=0 ;;
    --allow-dirty) DIRTY=1 ;;
    --full-check) SKIP_TYPECHECK=0 ;;
    *) echo "unknown option $arg"; exit 2 ;;
  esac
done
[ "$BACKUP" = auto ] && BACKUP=$SCHEMA

export MSYS_NO_PATHCONV=1
ssh_() { ssh -i "$KEY" -o ConnectTimeout=20 -o ServerAliveInterval=15 "$HOST" "$@"; }
START=$(date +%s)
lap() { echo "[$(( $(date +%s) - START ))s] $*"; }

REPO=$(git rev-parse --show-toplevel)
cd "$REPO"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SHA=$(git rev-parse --short HEAD)
TAG="act-erp-lite-web:$SHA-$STAMP"
TOOLS_TAG="act-erp-lite-tools:$SHA-$STAMP"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# Docker on Windows needs Windows-style paths.
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }

# 1. Same code you tested = same code you ship.
DIRTY_FILES=$(git status --porcelain --untracked-files=no -- act-erp-ai/apps/web | head -20 || true)
if [ -n "$DIRTY_FILES" ] && [ "$DIRTY" = 0 ]; then
  echo "ABORT: uncommitted edits in apps/web (commit them, or pass --allow-dirty to ship HEAD only):"
  echo "$DIRTY_FILES"; exit 1
fi
if [ -z "$DIRTY_FILES" ]; then
  ( cd act-erp-ai/apps/web && npx tsc --noEmit ) || { echo "ABORT: type check failed"; exit 1; }
  lap "type check ok"
else
  echo "WARN: dirty tree, skipping local type check; building committed HEAD ($SHA)"
fi

# 2. Export committed code and the prod env (as a build-only secret, never stored).
mkdir -p "$WORK/src"
git archive HEAD act-erp-ai | tar -x -C "$WORK/src"
CTX="$WORK/src/act-erp-ai/apps/web"
DOCKERFILE="$WORK/src/act-erp-ai/infra/Dockerfile.web"
ssh_ "cat $REMOTE_ROOT/apps/web/.env.prod" > "$WORK/env_prod"
chmod 600 "$WORK/env_prod"
lap "exported $SHA"

# 3. Build here (BuildKit cache makes repeat builds fast).
export DOCKER_BUILDKIT=1
docker build -f "$(winpath "$WORK/src/act-erp-ai/infra/Dockerfile.web")" \
  --secret "id=env_prod,src=$(winpath "$WORK/env_prod")" \
  --build-arg "SKIP_TYPECHECK=$SKIP_TYPECHECK" \
  -t "$TAG" "$(winpath "$CTX")"
lap "web image built"
SHIP=("$TAG")
if [ "$SCHEMA" = 1 ]; then
  docker build -f "$(winpath "$WORK/src/act-erp-ai/infra/Dockerfile.web")" --target build \
    --secret "id=env_prod,src=$(winpath "$WORK/env_prod")" \
    --build-arg "SKIP_TYPECHECK=$SKIP_TYPECHECK" \
    -t "$TOOLS_TAG" "$(winpath "$CTX")"
  SHIP+=("$TOOLS_TAG")
  lap "tools image built"
fi

# 4. Ship.
# A private registry on the server (127.0.0.1 only) reached through an SSH tunnel.
# `docker push` sends only the layers the server does not already have, so a normal
# deploy uploads a few MB instead of the whole image. Docker Desktop's daemon cannot
# see the Windows loopback, so a small socat container forwards to the tunnel.
TUNNEL_PORT=15000; FWD_PORT=15001
ssh -i "$KEY" -o ConnectTimeout=20 -o ExitOnForwardFailure=yes -N -L "127.0.0.1:$TUNNEL_PORT:127.0.0.1:5000" "$HOST" &
TUNNEL_PID=$!
docker rm -f act-reg-fwd >/dev/null 2>&1 || true
docker run -d --name act-reg-fwd -p "127.0.0.1:$FWD_PORT:5000" alpine/socat   tcp-listen:5000,fork,reuseaddr "tcp:host.docker.internal:$TUNNEL_PORT" >/dev/null
trap 'rm -rf "$WORK"; docker rm -f act-reg-fwd >/dev/null 2>&1 || true; kill "$TUNNEL_PID" 2>/dev/null || true' EXIT
sleep 3
for img in "${SHIP[@]}"; do
  name=${img%%:*}; tag=${img##*:}; short=${name#act-erp-lite-}
  docker tag "$img" "127.0.0.1:$FWD_PORT/act-$short:$tag"
  docker push -q "127.0.0.1:$FWD_PORT/act-$short:$tag" >/dev/null
done
ssh_ "for i in ${SHIP[*]}; do n=\${i%%:*}; t=\${i##*:}; s=\${n#act-erp-lite-}; docker pull -q localhost:5000/act-\$s:\$t >/dev/null && docker tag localhost:5000/act-\$s:\$t \$i; done" </dev/null
lap "image on server"

# 5. Server side: one deploy at a time.
ssh_ bash -s -- "$TAG" "$TOOLS_TAG" "$SCHEMA" "$WARM" "$BACKUP" "$SITE" "$REMOTE_ROOT" "$STAMP" <<'REMOTE'
set -euo pipefail
TAG=$1; TOOLS_TAG=$2; SCHEMA=$3; WARM=$4; BACKUP=$5; SITE=$6; ROOT=$7; STAMP=$8
export PATH="/home/ubuntu/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
exec 9>/tmp/act-deploy.lock
flock -n 9 || { echo "ABORT: another deploy holds /tmp/act-deploy.lock"; exit 1; }
RELEASE=/home/ubuntu/act-releases/$STAMP
mkdir -m 700 -p "$RELEASE"
COMPOSE=(docker compose -f "$ROOT/infra/docker-compose.prod-lite.yml")
cd "$ROOT"

grep -q '^WATCH_CRON_TOKEN=' apps/web/.env.prod || echo "WATCH_CRON_TOKEN=$(openssl rand -hex 32)" >> apps/web/.env.prod

if [ "$BACKUP" = 1 ]; then
  "${COMPOSE[@]}" exec -T postgres pg_dump -U act -d act -Fc > "$RELEASE/database-before.dump" </dev/null
  echo "backup done"
fi

PREV=$(docker inspect act-erp-lite-web-1 --format '{{.Image}}')
echo "$PREV" > "$RELEASE/previous-image.txt"
docker tag "$PREV" "act-erp-lite-web:before-$STAMP"

if [ "$SCHEMA" = 1 ]; then
  docker tag "$TOOLS_TAG" act-erp-lite-tools:latest
  "${COMPOSE[@]}" --profile tools run --rm -T --no-build tools prisma db push </dev/null 2>&1 | tee "$RELEASE/db-push.log"
  echo "schema push done"
fi

if [ "$WARM" = 1 ]; then
  WARM_NAME=act-persona-warm
  docker rm -f "$WARM_NAME" >/dev/null 2>&1 || true
  docker run -d --name "$WARM_NAME" --network act-erp-lite_default \
    --env-file apps/web/.env.prod -e HOSTNAME=0.0.0.0 -e TZ=America/Chicago "$TAG" >/dev/null
  ok=0
  for i in $(seq 1 60); do
    if docker exec "$WARM_NAME" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ok=1; break; fi
    sleep 2
  done
  docker rm -f "$WARM_NAME" >/dev/null 2>&1 || true
  [ "$ok" = 1 ] || { echo "WARM_FAILED (nothing switched)"; exit 1; }
  echo "warm ok"
fi

switch() {
  docker tag "$1" act-erp-lite-web:latest
  "${COMPOSE[@]}" up -d --no-deps --no-build --force-recreate web > "$RELEASE/switch.log" 2>&1
  for i in $(seq 1 45); do
    [ "$(docker inspect act-erp-lite-web-1 --format '{{.State.Health.Status}}')" = healthy ] && break
    sleep 2
  done
  [ "$(docker inspect act-erp-lite-web-1 --format '{{.State.Health.Status}}')" = healthy ] || return 1
  for p in /api/health /login; do
    code=$(curl --retry 3 --retry-delay 2 --connect-timeout 5 --max-time 20 -sS -o /dev/null -w '%{http_code}' "$SITE$p")
    echo "$p=$code"
    [ "$code" = 200 ] || return 1
  done
}

if ! switch "$TAG"; then
  echo "NEW IMAGE UNHEALTHY, rolling back"
  switch "act-erp-lite-web:before-$STAMP" && echo "ROLLED_BACK" || echo "ROLLBACK_FAILED"
  exit 1
fi

# Watch cron (every 15 minutes), installed once.
if ! crontab -l 2>/dev/null | grep -q watch-run.sh; then
  cat > /home/ubuntu/bin/watch-run.sh <<'CRON'
#!/bin/bash
TOKEN=$(grep '^WATCH_CRON_TOKEN=' /home/ubuntu/act-erp-ai/act-erp-ai/apps/web/.env.prod | cut -d= -f2-)
curl -sS --max-time 120 -X POST -H "Authorization: Bearer $TOKEN" https://persona.americancompletiontools.com/api/internal/watch/run
CRON
  chmod 700 /home/ubuntu/bin/watch-run.sh
  ( crontab -l 2>/dev/null; echo '*/15 * * * * /home/ubuntu/bin/watch-run.sh >> /home/ubuntu/act-backups/watch-run.log 2>&1' ) | crontab -
  echo "watch cron installed"
fi

docker image prune -f >/dev/null 2>&1 || true
# Keep the 4 newest shipped web images (rollback targets); drop older ones.
docker images act-erp-lite-web --format '{{.Tag}}' | grep -E '^[0-9a-f]{7,}-' | sort -r | tail -n +5 | while read -r t; do docker rmi "act-erp-lite-web:$t" >/dev/null 2>&1 || true; done
docker images act-erp-lite-tools --format '{{.Tag}}' | grep -E '^[0-9a-f]{7,}-' | sort -r | tail -n +3 | while read -r t; do docker rmi "act-erp-lite-tools:$t" >/dev/null 2>&1 || true; done
echo "{\"status\":\"deployed\",\"image\":\"$TAG\",\"stamp\":\"$STAMP\"}" | tee "$RELEASE/release-result.json"
echo DEPLOY_OK
REMOTE
lap "done"
