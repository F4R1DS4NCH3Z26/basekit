#!/usr/bin/env bash
# Silent verification of the basekit CLI. Usage: verify.sh [test-name-pattern]. No network, no npx.
# Compiles, checks that the committed dist/src matches src/, and runs the node:test suite
# (or only the tests whose name matches the pattern).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
MAX="${MAX_LINES:-30}"; fail=0; bin=node_modules/.bin
run() { local label=$1 mode=$2 out; shift 2
  if out=$("$@" 2>&1); then echo "OK   $label"
  else fail=1; echo "FAIL $label"; printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | "$mode" -n "$MAX"; fi; }
[ -x "$bin/tsc" ] || { echo "ERROR: falta node_modules (npm ci)"; exit 2; }
run tsc  head "$bin/tsc" -p tsconfig.json --pretty false
# dist/src is committed (git installs run it without building): after a change in src/ it changes too.
[ -z "$(git status --porcelain -- dist/src)" ] || echo "NOTA dist/src cambió al compilar: inclúyelo en el commit"
tests=$(find dist/tests -name '*.test.js' | sort)
# shellcheck disable=SC2086
run test tail node --test --test-concurrency=4 --test-reporter=dot ${1:+--test-name-pattern="$1"} $tests
[ $fail -eq 0 ] && echo "verify: OK" || echo "verify: FALLO"; exit $fail
