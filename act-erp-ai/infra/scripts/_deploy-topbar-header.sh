#!/bin/bash
# Compact page header: title/actions/hours tabs move into the top bar.
# Overlay from /tmp/topbar-header-overlay.tar.gz (apps/web relative paths).
set -euo pipefail
export PATH="/home/ubuntu/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
ROOT=/home/ubuntu/act-erp-ai/act-erp-ai
WEB=$ROOT/apps/web
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RELEASE=/home/ubuntu/act-releases/topbar-header-$STAMP
mkdir -m 700 -p "$RELEASE"
COMPOSE=(docker compose -f "$ROOT/infra/docker-compose.prod-lite.yml")
CANDIDATE_TAG="act-erp-lite-web:topbar-header-$STAMP"
WARM_NAME="act-persona-topbar-header-warm"
OVERLAY=/tmp/topbar-header-overlay.tar.gz

cd "$ROOT"
echo "RELEASE=$RELEASE"
test -f "$OVERLAY"
"${COMPOSE[@]}" exec -T postgres pg_dump -U act -d act -Fc > "$RELEASE/database-before.dump"

echo "=== backup .env.prod ==="
cp -a "$WEB/.env.prod" "$RELEASE/env.prod.before"

echo "=== overlay web sources ==="
tar -C "$WEB" -xzf "$OVERLAY"
cp -a "$RELEASE/env.prod.before" "$WEB/.env.prod"
test -f "$WEB/src/components/topbar-slot.ts"
grep -n 'page-header-slot' "$WEB/src/components/app-topbar.tsx" | head -2

PREV=$(docker inspect act-erp-lite-web-1 --format '{{.Image}}')
echo "$PREV" > "$RELEASE/previous-image.txt"
docker tag "$PREV" "act-erp-lite-web:before-topbar-header-$STAMP" || true

echo "=== build web + tools ==="
"${COMPOSE[@]}" build web tools > "$RELEASE/build-web.log" 2>&1
docker tag act-erp-lite-web:latest "$CANDIDATE_TAG"
docker image inspect "$CANDIDATE_TAG" --format '{{.Id}}' | tee "$RELEASE/candidate-image.txt"

echo "=== warm ==="
docker rm -f "$WARM_NAME" >/dev/null 2>&1 || true
docker run -d --name "$WARM_NAME" --network act-erp-lite_default \
  --env-file "$WEB/.env.prod" -e HOSTNAME=0.0.0.0 -e TZ=America/Chicago \
  "$CANDIDATE_TAG" >"$RELEASE/warm-container.txt"
ok=0
for i in $(seq 1 60); do
  if docker exec "$WARM_NAME" node -e "Promise.all(['/api/health','/login'].map(async p=>{const r=await fetch('http://127.0.0.1:3000'+p); if(r.status!==200) throw new Error(p+' '+r.status); if(p==='/api/health' && (await r.json()).status!=='ok') throw new Error('health');})).then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1)})"; then
    ok=1; break
  fi
  sleep 3
done
if [ "$ok" != 1 ]; then
  docker logs "$WARM_NAME" >"$RELEASE/warm-failed.log" 2>&1 || true
  docker rm -f "$WARM_NAME" >/dev/null 2>&1 || true
  echo WARM_FAILED; exit 1
fi
echo WARM_OK

echo "=== switch ==="
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
echo "{\"status\":\"deployed\",\"release\":\"$RELEASE\",\"stamp\":\"$STAMP\"}" | tee "$RELEASE/release-result.json"
echo DEPLOY_OK
