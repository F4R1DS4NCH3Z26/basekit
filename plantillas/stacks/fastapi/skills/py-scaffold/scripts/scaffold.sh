#!/usr/bin/env bash
# Crea el esqueleto de un módulo Python. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9_]{1,40}$ ]] || { echo "Uso: scaffold.sh <modulo>  (snake_case, ej. orders)"; exit 2; }
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
[ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f manage.py ] || { echo "ERROR: ejecútalo en la raíz del proyecto Python"; exit 2; }
dir="src/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
pascal=$(echo "$name" | awk -F_ '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')

mkdir -p "$dir/tests" docs/specs
[ -e src/modules/__init__.py ] || : > src/modules/__init__.py
put() { [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }; printf '%s\n' "$2" > "$1"; echo "  + $1"; }
c="Contrato: docs/specs/${name}_contract.md"
put "$dir/__init__.py"   ""
put "$dir/models.py"     "\"\"\"Modelos ORM de $name. $c § data-writer.\"\"\""
put "$dir/schemas.py"    "\"\"\"Schemas de entrada/salida de $name. $c § data-writer.\"\"\""
put "$dir/exceptions.py" "\"\"\"Excepciones de dominio de $name. $c § logic-writer.\"\"\""
put "$dir/services.py"   "\"\"\"Casos de uso de $name (sin HTTP). $c § logic-writer.\"\"\""
put "$dir/router.py"     "\"\"\"Endpoints HTTP de $name. $c § web-writer.\"\"\""
put "$dir/tests/__init__.py" ""
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name"
echo "Registro (orquestador, src/main.py): from src.modules.$name.router import router as ${name}_router; app.include_router(${name}_router)"
