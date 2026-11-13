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
camel="$(echo "${pascal:0:1}" | tr '[:upper:]' '[:lower:]')${pascal:1}"
# Same source as app-setup.sh: the DB_DRIVER of the overlay infra-setup activated. mongodb → Mongoose; anything else → SQL.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)

mkdir -p "$dir/components" "tests/features/$name" docs/specs
put() { [ -e "$1" ] && { echo "  = $1 (existe, se conserva)"; return 0; }; printf '%s\n' "$2" > "$1"; echo "  + $1"; }

put "$dir/schemas.ts"   "import { z } from \"zod\";

// Schemas de $name. Contrato: docs/specs/${name}_contract.md § data-writer"
if [ "$driver" = mongodb ]; then
put "$dir/model.ts"     "import { randomUUID } from \"node:crypto\";
import { model, Schema } from \"mongoose\";

// Modelo Mongoose de $name: campos e índices (en dev los crea la app al conectar; en prod, make migrate).
// Contrato: docs/specs/${name}_contract.md § Común. overwriteModels: next dev vuelve a evaluar el módulo al recargar.
const ${camel}Schema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
  },
  { collection: \"$name\", timestamps: true, versionKey: false },
);

export const ${pascal}Model = model(\"${pascal}\", ${camel}Schema, undefined, { overwriteModels: true });"
put "$dir/services.ts"  "import \"server-only\";

// Acceso a datos de $name (solo servidor): cada función hace await connectDb() (@/lib/db) y usa ${pascal}Model
// (./model.ts) con proyección y .lean()."
keep=mongo; drop=sql
else
put "$dir/services.ts"  "import \"server-only\";

// Acceso a datos de $name (solo servidor)."
keep=sql; drop=mongo
fi
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
# The contract template carries both data models between <!-- sql --> and <!-- mongo --> markers: keep this project's.
else sed -e "/<!-- $drop -->/,/<!-- \/$drop -->/d" -e "/<!-- \/*$keep -->/d" -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" \
  "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name → llena el contrato y márcalo 'Estado: cerrado'"
