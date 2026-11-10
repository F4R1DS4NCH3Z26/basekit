#!/usr/bin/env bash
# Verificación silenciosa para Go. Uso: verify.sh [ruta]. Sin red por defecto (OFFLINE=0 la permite); no instala nada.
set -uo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
scope="${1:-.}"; MAX="${MAX_LINES:-30}"; fail=0
re='^[A-Za-z0-9_./-]+$'
[[ $scope =~ $re && $scope != *..* && $scope != /* ]] || { echo "ERROR: ruta inválida: $scope"; exit 2; }
[ -d "$scope" ] || { echo "ERROR: no existe el directorio $scope"; exit 2; }
[ -f go.mod ] || { echo "ERROR: falta go.mod en $root"; exit 2; }
command -v go >/dev/null 2>&1 || { echo "SKIP go (no está instalado: usa make verify)"; exit 2; }
[ "${OFFLINE:-1}" = 1 ] && export GOPROXY=off GOFLAGS="${GOFLAGS:-} -mod=readonly"
scope="${scope%/}"; pkgs="./$scope/..."; [ "$scope" = . ] && pkgs="./..."

run() { # etiqueta, head|tail, comando...
  local label=$1 mode=$2 out; shift 2
  if out=$("$@" 2>&1); then echo "OK   $label"
  else fail=1; echo "FAIL $label"; printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | "$mode" -n "$MAX"; fi
}
gofmt_check() { local out; out=$(gofmt -l "$scope") || return 1; [ -z "$out" ] || { printf 'sin formato (gofmt -w):\n%s\n' "$out"; return 1; }; }
tests() { local out rc; out=$(go test -count=1 "$pkgs" 2>&1); rc=$?; printf '%s\n' "$out" | grep -v -e '^ok ' -e 'no test files'; return $rc; }

run gofmt head gofmt_check
run "go vet" head go vet "$pkgs"
if go tool -n staticcheck >/dev/null 2>&1; then run staticcheck head go tool staticcheck "$pkgs"; else echo "SKIP staticcheck (falta la directiva tool en go.mod)"; fi
run "go test" tail tests

[ $fail -eq 0 ] && echo "verify: OK" || echo "verify: FALLO"
exit $fail
