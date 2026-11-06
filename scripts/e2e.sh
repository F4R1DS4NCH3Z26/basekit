#!/usr/bin/env bash
# Acceptance test 12 (spec 02 §13): after `basekit init` and `make new-app`, a real `make dev`
# must answer on the stack healthcheck. Needs Docker; meant for CI.
# Usage: scripts/e2e.sh <stack> [db] [--prod]
#   db: postgres | mysql | sqlite (default: no database). --prod: production images (make prod-up) instead of make dev.
set -euo pipefail

usage() { echo "Uso: scripts/e2e.sh <stack> [postgres|mysql|sqlite] [--prod]" >&2; exit 2; }
stack="${1:-}"
[ $# -gt 0 ] && shift
db=""
env="dev"
for arg in "$@"; do
  case "$arg" in
    --prod) env="prod" ;;
    postgres | mysql | sqlite) db="$arg" ;;
    *) usage ;;
  esac
done
case "$stack" in "" | *[!a-z0-9-]*) usage ;; esac
repo="$(cd "$(dirname "$0")/.." && pwd)"
tpl="$repo/plantillas/stacks/$stack"
[ -f "$tpl/stack.json" ] || { echo "Stack desconocido: $stack" >&2; exit 2; }
[ -f "$repo/dist/src/cli.js" ] || { echo "Falta dist/: ejecuta npm run build" >&2; exit 2; }

port_of_stack() { node -p 'require(process.argv[1]).port' "$tpl/stack.json"; }

work="$(mktemp -d)"
app="$work/e2e-$stack-$env"   # unique compose project name, so runs can go in parallel
env_file=".env"
[ "$env" = prod ] && env_file=".env.prod"
compose() {
  local files=(-f compose.yaml -f "compose.$env.yaml") f
  for f in compose.db.yaml compose.redis.yaml; do [ -f "$f" ] && files+=(-f "$f"); done
  docker compose --env-file "$env_file" "${files[@]}" "$@"
}
cleanup() {
  if [ -f "$app/compose.yaml" ]; then (cd "$app" && compose down -v --rmi local --remove-orphans >/dev/null 2>&1) || true; fi
  # Files created by containers may belong to root on Linux.
  rm -rf "$work" 2>/dev/null || docker run --rm -v "$work:/w" alpine:3.22 rm -rf "/w/$(basename "$app")" >/dev/null 2>&1 || true
  rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT

node "$repo/dist/src/cli.js" init "$app" -y --no-external-skills --stack "$stack" --agents codex ${db:+--db "$db"}
cd "$app"
# new-app is idempotent: it creates whatever the framework still lacks (the app, or uv.lock next to the starter).
make new-app
if [ "$env" = prod ]; then
  make env ENV=prod
  make prod-up
else
  make env
  make dev
fi

# The healthcheck path comes from the stack's own Dockerfile HEALTHCHECK, so this script stays stack-agnostic.
path="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9/_.-]*' "$tpl/files/Dockerfile" | head -1 | sed -E 's#^http://127\.0\.0\.1:[0-9]+##')"
port="$(sed -n 's/^APP_PORT=//p' .env.example | head -1)"
url="http://127.0.0.1:${port:-$(port_of_stack)}${path:-/}"

for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "$url"; then
    # With the SQLite overlay the app (non-root in prod) must be able to write its database directory.
    if [ "$db" = sqlite ] && ! compose exec -T app sh -c 'touch /app/data/.write-test && rm /app/data/.write-test'; then
      echo "FALLO: $stack ($env) no puede escribir en /app/data" >&2
      exit 1
    fi
    echo "OK $stack${db:+ + $db} ($env) responde en $url"
    exit 0
  fi
  sleep 5
done
echo "FALLO: $stack no respondió en $url" >&2
compose ps >&2 || true
compose logs --tail=80 >&2 || true
exit 1
