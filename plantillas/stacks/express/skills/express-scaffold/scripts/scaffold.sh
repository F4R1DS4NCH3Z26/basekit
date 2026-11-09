#!/usr/bin/env bash
# Crea el esqueleto de un módulo Express. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9-]{1,40}$ ]] || { echo "Uso: scaffold.sh <modulo>  (kebab-case, ej. products)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f src/app.ts ] || { echo "ERROR: ejecútalo en la raíz del proyecto (falta src/app.ts)"; exit 2; }
dir="src/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
pascal=$(echo "$name" | awk -F- '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')
camel="$(echo "${pascal:0:1}" | tr '[:upper:]' '[:lower:]')${pascal:1}"

mkdir -p "$dir" "tests/modules/$name" docs/specs
put() { [ -e "$1" ] && { echo "  = $1 (existe, se conserva)"; return 0; }; printf '%s\n' "$2" > "$1"; echo "  + $1"; }
c="Contrato: docs/specs/${name}_contract.md"
put "$dir/schemas.ts"    "// Schemas Zod de $name (.strict()) y sus tipos. $c § data-writer
export {};"
put "$dir/repository.ts" "// Acceso a datos de $name: db() de src/lib/db.ts, siempre con select. $c § data-writer
export {};"
put "$dir/errors.ts"     "// Errores de dominio de $name. $c § logic-writer
export {};"
put "$dir/services.ts"   "// Casos de uso de $name (sin Express ni Prisma). $c § logic-writer
export {};"
put "$dir/router.ts"     "import { Router } from \"express\";

// Endpoints HTTP de $name. $c § web-writer
export const ${camel}Router = Router();"
put "tests/modules/$name/.gitkeep" ""
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe, se conserva)"
else sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name → llena el contrato y márcalo 'Estado: cerrado'"
echo "Registro (orquestador, src/app.ts): import { ${camel}Router } from \"./modules/$name/router.js\"; app.use(\"/$name\", ${camel}Router);"
