#!/usr/bin/env bash
# Crea el esqueleto de una feature Next.js. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9-]{1,40}$ ]] || { echo "Uso: scaffold.sh <feature>  (kebab-case, ej. products)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f package.json ] || { echo "ERROR: ejecútalo en la raíz del proyecto (falta package.json)"; exit 2; }
dir="src/features/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
pascal=$(echo "$name" | awk -F- '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')

mkdir -p "$dir/components" "tests/features/$name" docs/specs
put() { [ -e "$1" ] && { echo "  = $1 (existe, se conserva)"; return 0; }; printf '%s\n' "$2" > "$1"; echo "  + $1"; }

put "$dir/schemas.ts"   "import { z } from \"zod\";

// Schemas de $name. Contrato: docs/specs/${name}_contract.md § data-writer"
put "$dir/services.ts"  "import \"server-only\";

// Acceso a datos de $name (solo servidor)."
put "$dir/actions.ts"   "\"use server\";

// Server Actions de $name. Patrón: skill nextjs-patterns (auth + safeParse + ActionResult)."
put "$dir/server.ts"    "import \"server-only\";

// API pública de servidor de $name: reexporta aquí los services que otros pueden usar."
put "$dir/index.ts"     "// API pública de $name: solo componentes, tipos y schemas (nada server-only).
export {};"
put "$dir/components/.gitkeep" ""
put "tests/features/$name/.gitkeep" ""
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe, se conserva)"
else sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name → llena el contrato y márcalo 'Estado: cerrado'"
