#!/usr/bin/env bash
# Verificación silenciosa para Symfony. Uso: verify.sh [ruta]. Sin red; no instala nada.
set -uo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
scope="${1:-src}"; MAX="${MAX_LINES:-30}"; fail=0
re='^[A-Za-z0-9_./-]+$'
[[ $scope =~ $re && $scope != *..* && $scope != /* ]] || { echo "ERROR: ruta inválida: $scope"; exit 2; }
[ -e "$scope" ] || { echo "ERROR: no existe $scope"; exit 2; }
command -v php >/dev/null || { echo "ERROR: php no está en el PATH"; exit 2; }
v=vendor/bin

run() { # etiqueta, head|tail, comando...
  local label=$1 mode=$2 out; shift 2
  if out=$("$@" 2>&1); then echo "OK   $label"
  else fail=1; echo "FAIL $label"; printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | "$mode" -n "$MAX"; fi
}
lint_all() { # php -l por archivo; solo imprime errores
  local out; out=$(find "$scope" -name '*.php' -print0 | xargs -0 -r -n1 sh -c 'php -l "$1" || :' _ 2>&1 | grep -v -e '^No syntax errors' -e '^Errors parsing')
  [ -z "$out" ] && return 0; printf '%s\n' "$out"; return 1
}

run "php -l" head lint_all
if [ -x $v/php-cs-fixer ]; then run php-cs-fixer head $v/php-cs-fixer fix --dry-run --diff --no-interaction "$scope"
else echo "SKIP estilo"; fi
if [ -x $v/phpstan ]; then run phpstan head $v/phpstan analyse --no-progress --error-format=raw --memory-limit=1G "$scope"
else echo "SKIP phpstan"; fi
if [ -f bin/console ] && [ -d vendor ]; then run "lint:container" head php bin/console lint:container --no-interaction
else echo "SKIP lint:container"; fi

tests="tests"
case "$scope" in src/Modules/*) m=${scope#src/Modules/}; tests="tests/Modules/${m%%/*}";; esac
if [ ! -d "$tests" ] || [ -z "$(find "$tests" -name '*Test.php' -print -quit)" ]; then echo "SKIP tests (sin tests en $tests)"
elif [ -x $v/phpunit ]; then run "phpunit ($tests)" tail $v/phpunit --stop-on-failure "$tests"
else echo "SKIP tests"; fi

[ $fail -eq 0 ] && echo "verify: OK" || echo "verify: FALLO"
exit $fail
