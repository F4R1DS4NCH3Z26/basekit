#!/usr/bin/env bash
# Crea el esqueleto de una feature de la SPA React. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9-]{1,40}$ ]] || { echo "Uso: scaffold.sh <feature>  (kebab-case, ej. products)"; exit 2; }
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
[ -f package.json ] || { echo "ERROR: ejecútalo en la raíz del proyecto (falta package.json; corre make new-app)"; exit 2; }
dir="src/features/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
pascal=$(echo "$name" | awk -F- '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')

mkdir -p "$dir/components" "$dir/hooks" "$dir/pages" "tests/features/$name" docs/specs
put() { [ -e "$1" ] && { echo "  = $1 (existe, se conserva)"; return 0; }; printf '%s\n' "$2" > "$1"; echo "  + $1"; }

put "$dir/schemas.ts"   "import { z } from \"zod\";

// Schemas de $name (respuestas de la API y formularios). Contrato: docs/specs/${name}_contract.md § logic-writer"
put "$dir/api.ts"       "// Llamadas a la API de $name con apiFetch (src/lib/api.ts) y un schema de schemas.ts. Patrón: skill react-patterns."
put "$dir/index.ts"     "// API pública de $name: componentes, páginas, hooks y tipos que otras features pueden usar.
export {};"
put "$dir/components/.gitkeep" ""
put "$dir/hooks/.gitkeep" ""
put "$dir/pages/.gitkeep" ""
put "tests/features/$name/.gitkeep" ""
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe, se conserva)"
else sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name → llena el contrato y márcalo 'Estado: cerrado'"
