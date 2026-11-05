#!/usr/bin/env bash
# Acceptance test 12 (spec 02 §13): after `basekit init` and `make new-app`, a real `make dev`
# must answer on the stack healthcheck. Needs Docker; meant for CI. Usage: scripts/e2e.sh <stack>
set -euo pipefail

stack="${1:-}"
case "$stack" in "" | *[!a-z0-9-]*) echo "Uso: scripts/e2e.sh <stack>" >&2; exit 2 ;; esac
repo="$(cd "$(dirname "$0")/.." && pwd)"
tpl="$repo/plantillas/stacks/$stack"
[ -f "$tpl/stack.json" ] || { echo "Stack desconocido: $stack" >&2; exit 2; }
[ -f "$repo/dist/src/cli.js" ] || { echo "Falta dist/: ejecuta npm run build" >&2; exit 2; }

json() { node -p 'const s = require(process.argv[1]); s[process.argv[2]] ?? ""' "$tpl/stack.json" "$1"; }

work="$(mktemp -d)"
app="$work/app"
cleanup() {
  if [ -f "$app/compose.yaml" ]; then
    (cd "$app" && docker compose --env-file .env -f compose.yaml -f compose.dev.yaml down -v --rmi local --remove-orphans >/dev/null 2>&1) || true
  fi
  rm -rf "$work" 2>/dev/null || docker run --rm -v "$work:/w" alpine:3.22 rm -rf /w/app >/dev/null 2>&1 || true
  rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT

node "$repo/dist/src/cli.js" init "$app" -y --no-external-skills --stack "$stack" --agents codex
cd "$app"
marker="$(json appMarker)"
if [ -n "$marker" ] && [ ! -e "$marker" ]; then make new-app; fi
make env
make dev

# The healthcheck path comes from the stack's own Dockerfile HEALTHCHECK, so this script stays stack-agnostic.
path="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9/_.-]*' "$tpl/files/Dockerfile" | head -1 | sed -E 's#^http://127\.0\.0\.1:[0-9]+##')"
port="$(sed -n 's/^APP_PORT=//p' .env.example | head -1)"
url="http://127.0.0.1:${port:-$(json port)}${path:-/}"

for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "$url"; then
    echo "OK $stack responde en $url"
    exit 0
  fi
  sleep 5
done
echo "FALLO: $stack no respondió en $url" >&2
docker compose --env-file .env -f compose.yaml -f compose.dev.yaml logs --tail=80 >&2 || true
exit 1
