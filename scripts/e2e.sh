#!/usr/bin/env bash
# Acceptance test 12 (spec 02 §13): after `basekit init` and `make new-app`, a real `make dev`
# must answer on the stack healthcheck. Needs Docker; meant for CI.
# Usage: scripts/e2e.sh <stack> [db]   (db: postgres | mysql | sqlite; default: no database)
set -euo pipefail

stack="${1:-}"
db="${2:-}"
case "$stack" in "" | *[!a-z0-9-]*) echo "Uso: scripts/e2e.sh <stack> [db]" >&2; exit 2 ;; esac
case "$db" in "" | postgres | mysql | sqlite) ;; *) echo "db inválida: $db" >&2; exit 2 ;; esac
repo="$(cd "$(dirname "$0")/.." && pwd)"
tpl="$repo/plantillas/stacks/$stack"
[ -f "$tpl/stack.json" ] || { echo "Stack desconocido: $stack" >&2; exit 2; }
[ -f "$repo/dist/src/cli.js" ] || { echo "Falta dist/: ejecuta npm run build" >&2; exit 2; }

port_of_stack() { node -p 'require(process.argv[1]).port' "$tpl/stack.json"; }

work="$(mktemp -d)"
app="$work/app"
compose() {
  local files=(-f compose.yaml -f compose.dev.yaml) f
  for f in compose.db.yaml compose.redis.yaml; do [ -f "$f" ] && files+=(-f "$f"); done
  docker compose --env-file .env "${files[@]}" "$@"
}
cleanup() {
  if [ -f "$app/compose.yaml" ]; then (cd "$app" && compose down -v --rmi local --remove-orphans >/dev/null 2>&1) || true; fi
  # Files created by containers may belong to root on Linux.
  rm -rf "$work" 2>/dev/null || docker run --rm -v "$work:/w" alpine:3.22 rm -rf /w/app >/dev/null 2>&1 || true
  rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT

node "$repo/dist/src/cli.js" init "$app" -y --no-external-skills --stack "$stack" --agents codex ${db:+--db "$db"}
cd "$app"
# new-app is idempotent: it creates whatever the framework still lacks (the app, or uv.lock next to the starter).
make new-app
make env
make dev

# The healthcheck path comes from the stack's own Dockerfile HEALTHCHECK, so this script stays stack-agnostic.
path="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9/_.-]*' "$tpl/files/Dockerfile" | head -1 | sed -E 's#^http://127\.0\.0\.1:[0-9]+##')"
port="$(sed -n 's/^APP_PORT=//p' .env.example | head -1)"
url="http://127.0.0.1:${port:-$(port_of_stack)}${path:-/}"

for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "$url"; then
    echo "OK $stack${db:+ + $db} responde en $url"
    exit 0
  fi
  sleep 5
done
echo "FALLO: $stack no respondió en $url" >&2
compose ps >&2 || true
compose logs --tail=80 >&2 || true
exit 1
