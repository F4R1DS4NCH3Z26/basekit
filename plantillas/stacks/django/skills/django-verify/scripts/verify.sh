#!/usr/bin/env bash
# Verificación silenciosa para Django. Uso: verify.sh [ruta]. Sin red ni BD real; no instala nada.
set -uo pipefail
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
scope="${1:-src}"; MAX="${MAX_LINES:-30}"; fail=0
re='^[A-Za-z0-9_./-]+$'
[[ $scope =~ $re && $scope != *..* && $scope != /* ]] || { echo "ERROR: ruta inválida: $scope"; exit 2; }
[ -e "$scope" ] || { echo "ERROR: no existe $scope"; exit 2; }
venv="${VENV:-.venv}"
tool() { if [ -x "$venv/bin/$1" ]; then echo "$venv/bin/$1"; elif command -v "$1" >/dev/null 2>&1; then command -v "$1"; fi; }

run() { # etiqueta, head|tail, comando...
  local label=$1 mode=$2 out; shift 2
  if out=$("$@" 2>&1); then echo "OK   $label"
  else fail=1; echo "FAIL $label"; printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | "$mode" -n "$MAX"; fi
}
pytest_run() { "$PYTEST" -x -q --tb=short --no-header -p no:cacheprovider "$@"; local rc=$?; [ $rc -eq 5 ] && return 0; return $rc; }
# Test settings: in-memory SQLite, so `make verify` (run with --no-deps) never needs the database service.
django_run() { DJANGO_SETTINGS_MODULE=src.config.settings_test "$PY" manage.py "$@"; }

RUFF=$(tool ruff); MYPY=$(tool mypy); PYTEST=$(tool pytest); PY=$(tool python)
if [ -n "$RUFF" ]; then
  run "ruff check" head "$RUFF" check --quiet --output-format=concise "$scope"
  run "ruff format" head "$RUFF" format --check --quiet "$scope"
else echo "SKIP ruff"; fi
if [ -n "$MYPY" ]; then run mypy head "$MYPY" --no-pretty --no-color-output "$scope"; else echo "SKIP mypy"; fi
if [ -n "$PY" ] && [ -f manage.py ] && "$PY" -c "import django" >/dev/null 2>&1; then
  run "django check" head django_run check --fail-level WARNING
  run "migraciones al día" head django_run makemigrations --check --dry-run
else echo "SKIP django check"; fi
if [ -n "$PYTEST" ]; then
  t="$scope"; [ "$scope" = src ] && [ -d tests ] && t="src tests"
  # shellcheck disable=SC2086
  run pytest tail pytest_run $t
else echo "SKIP pytest"; fi

[ $fail -eq 0 ] && echo "verify: OK" || echo "verify: FALLO"
exit $fail
