#!/usr/bin/env bash
# Crea el esqueleto de un módulo Python. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9_]{1,40}$ ]] || { echo "Uso: scaffold.sh <modulo>  (snake_case, ej. orders)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f manage.py ] || { echo "ERROR: ejecútalo en la raíz del proyecto Python"; exit 2; }
dir="src/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
pascal=$(echo "$name" | awk -F_ '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')

mkdir -p "$dir/tests" docs/specs
[ -e src/modules/__init__.py ] || : > src/modules/__init__.py
put() { [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }; printf '%s\n' "$2" > "$1"; echo "  + $1"; }
# The contract goes on its own docstring line: with a long module name, one line would break ruff's E501 (100).
doc() { printf '"""%s\n\nContrato: docs/specs/%s_contract.md § %s.\n"""' "$1" "$name" "$2"; }
put "$dir/__init__.py"   ""
put "$dir/models.py"     "$(doc "Modelos ORM de $name." data-writer)"
put "$dir/schemas.py"    "$(doc "Schemas de entrada/salida de $name." data-writer)"
put "$dir/exceptions.py" "$(doc "Excepciones de dominio de $name." logic-writer)"
put "$dir/services.py"   "$(doc "Casos de uso de $name (sin HTTP)." logic-writer)"
put "$dir/router.py"     "$(doc "Endpoints HTTP de $name." web-writer)"
put "$dir/tests/__init__.py" ""
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name"
echo "Registro (orquestador, create_app() en src/main.py): from src.modules.$name.router import router as ${name}_router; app.include_router(${name}_router)"
