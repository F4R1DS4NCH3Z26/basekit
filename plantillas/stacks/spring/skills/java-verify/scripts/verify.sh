#!/usr/bin/env bash
# Verificación silenciosa para Spring Boot. Uso: verify.sh [dominio]. Offline por defecto.
set -uo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
mod="${1:-}"; MAX="${MAX_LINES:-30}"; fail=0
[ -z "$mod" ] || [[ $mod =~ ^[a-z][a-z0-9]{1,30}$ ]] || { echo "ERROR: dominio inválido: $mod"; exit 2; }
off=(); [ "${OFFLINE:-1}" = 1 ] && off=(-o)

clean_out() { # deja solo errores útiles
  grep -E '^\[ERROR\]|error:|FAILED|Tests run:.*Fail|What went wrong|^>|Caused by' \
  | grep -vE 'Help 1|Re-run Maven|For more information|full stack trace|^\[ERROR\] *$|-> \[Help' || true
}
run() { local label=$1 out; shift
  if out=$("$@" 2>&1); then echo "OK   $label"
  else fail=1; echo "FAIL $label"; printf '%s\n' "$out" | clean_out | head -n "$MAX"; fi
}

if [ -x ./mvnw ] || [ -f pom.xml ]; then
  mvn=./mvnw; [ -x "$mvn" ] || mvn=mvn
  run compile "$mvn" -q -B "${off[@]}" test-compile
  if [ -n "$mod" ]; then
    run "test ($mod)" "$mvn" -q -B "${off[@]}" surefire:test \
      "-Dtest=**/modules/$mod/**,**/ArchitectureTest" -Dsurefire.failIfNoSpecifiedTests=false
  else run test "$mvn" -q -B "${off[@]}" surefire:test; fi
elif [ -x ./gradlew ]; then
  goff=(); [ "${OFFLINE:-1}" = 1 ] && goff=(--offline)
  run compile ./gradlew -q "${goff[@]}" testClasses
  if [ -n "$mod" ]; then run "test ($mod)" ./gradlew -q "${goff[@]}" test --tests "*.modules.$mod.*" --tests "*ArchitectureTest"
  else run test ./gradlew -q "${goff[@]}" test; fi
else echo "ERROR: no encontré mvnw, pom.xml ni gradlew"; exit 2; fi

[ $fail -eq 0 ] && echo "verify: OK" || echo "verify: FALLO"
exit $fail
