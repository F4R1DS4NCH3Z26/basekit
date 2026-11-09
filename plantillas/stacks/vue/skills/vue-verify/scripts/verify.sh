#!/usr/bin/env bash
# Verificación silenciosa para Vue + Vite/TS. Uso: verify.sh [ruta]. Sin red; no usa npx.
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

# vue-tsc -b: plain tsc cannot read .vue files. The Vite template splits the project (tsconfig.app.json +
# tsconfig.node.json) behind references.
if [ -x "$bin/vue-tsc" ]; then run vue-tsc head "$bin/vue-tsc" -b --pretty false; else echo "SKIP vue-tsc"; fi
if [ -x "$bin/eslint" ]; then run eslint head "$bin/eslint" --quiet "$scope"; else echo "SKIP eslint"; fi

tests="tests"
case "$scope" in src/features/*) f=${scope#src/features/}; tests="tests/features/${f%%/*}";; esac
if [ -x "$bin/vitest" ]; then
  if [ -d "$tests" ]; then run "vitest ($tests)" tail "$bin/vitest" run --reporter=dot --passWithNoTests "$tests"
  else echo "SKIP vitest (sin $tests)"; fi
else echo "SKIP vitest"; fi

[ $fail -eq 0 ] && echo "verify: OK" || echo "verify: FALLO"
exit $fail
