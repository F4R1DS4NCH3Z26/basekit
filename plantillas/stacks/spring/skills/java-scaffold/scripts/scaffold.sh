#!/usr/bin/env bash
# Crea el esqueleto de un bounded context Spring Boot. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9]{1,30}$ ]] || { echo "Uso: scaffold.sh <dominio>  (minúsculas sin separadores, ej. orders)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f pom.xml ] || ls build.gradle* >/dev/null 2>&1 || { echo "ERROR: ejecútalo en la raíz del proyecto (falta pom.xml/build.gradle)"; exit 2; }

pkg="${BASE_PKG:-}"
if [ -z "$pkg" ]; then
  main=$(grep -rl --include='*.java' '@SpringBootApplication' src/main/java 2>/dev/null | head -1 || true)
  [ -n "$main" ] && pkg=$(sed -n 's/^package \([a-zA-Z0-9_.]*\);.*/\1/p' "$main" | head -1)
fi
[[ $pkg =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$ ]] || { echo "ERROR: no pude detectar el paquete base; usa BASE_PKG=com.ejemplo"; exit 2; }
ppath=${pkg//./\/}
dir="src/main/java/$ppath/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
pascal="$(tr '[:lower:]' '[:upper:]' <<< "${name:0:1}")${name:1}"

put() { [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }; mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; echo "  + $1"; }
desc_domain="Entidades, excepciones e interfaces de repositorio. Sin Spring Web ni application."
desc_infrastructure="Implementaciones de repositorios (Spring Data) e integraciones externas."
desc_application="Servicios transaccionales, DTOs record y mappers."
desc_presentation="Controladores REST. Solo dependen de application."
for layer in domain infrastructure application presentation; do
  d="desc_$layer"
  put "$dir/$layer/package-info.java" "/** $name · $layer: ${!d} Contrato: docs/specs/${name}_contract.md */
package $pkg.modules.$name.$layer;"
done
put "src/test/java/$ppath/modules/$name/.gitkeep" ""
mkdir -p src/main/resources/db/migration docs/specs
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" -e "s/__PKG__/$pkg/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
last=$(ls src/main/resources/db/migration 2>/dev/null | sed -n 's/^V\([0-9][0-9]*\)__.*/\1/p' | sort -n | tail -1)
echo "scaffold OK: $pkg.modules.$name · siguiente versión Flyway sugerida: V$(( ${last:-0} + 1 ))"
