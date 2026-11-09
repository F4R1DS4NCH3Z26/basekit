#!/usr/bin/env bash
# Verificación silenciosa para NestJS/TS. Uso: verify.sh [ruta]. Sin red; no usa npx.
set -uo pipefail
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
scope="${1:-src}"; MAX="${MAX_LINES:-30}"; fail=0
re='^[][A-Za-z0-9_./@()-]+$'
[[ $scope =~ $re && $scope != *..* && $scope != /* ]] || { echo "ERROR: ruta inválida: $scope"; exit 2; }
[ -e "$scope" ] || { echo "ERROR: no existe $scope"; exit 2; }
bin=node_modules/.bin
[ -d "$bin" ] || { echo "ERROR: falta node_modules (instala dependencias)"; exit 2; }

run() { # etiqueta, head|tail, comando...
  local label=$1 mode=$2 out; shift 2
  if out=$("$@" 2>&1); then echo "OK   $label"
  else fail=1; echo "FAIL $label"; printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | "$mode" -n "$MAX"; fi
}

# El cliente de Prisma es código generado (src/generated, ignorado por git): sin él, tsc falla en cada import.
if [ -f prisma/schema.prisma ] && [ ! -d src/generated/prisma ] && [ -x "$bin/prisma" ]; then
  run "prisma generate" head env PRISMA_HIDE_UPDATE_MESSAGE=1 "$bin/prisma" generate
fi
if [ -x "$bin/tsc" ]; then run tsc head "$bin/tsc" --noEmit --pretty false -p tsconfig.json; else echo "SKIP tsc"; fi
if [ -x "$bin/oxlint" ]; then run oxlint head "$bin/oxlint" --quiet --ignore-pattern 'src/generated/**' "$scope"; else echo "SKIP oxlint"; fi

# Los tests viven junto al código (*.spec.ts): vitest filtra por la ruta.
if [ -x "$bin/vitest" ]; then run "vitest ($scope)" tail "$bin/vitest" run --reporter=dot --passWithNoTests "$scope"
else echo "SKIP vitest"; fi

[ $fail -eq 0 ] && echo "verify: OK" || echo "verify: FALLO"
exit $fail
