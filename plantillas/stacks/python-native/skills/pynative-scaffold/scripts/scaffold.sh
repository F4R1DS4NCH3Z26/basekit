#!/usr/bin/env bash
# Crea el esqueleto de un módulo de la API WSGI nativa. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9_]{1,40}$ ]] || { echo "Uso: scaffold.sh <modulo>  (snake_case, ej. orders)"; exit 2; }
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
[ -f pyproject.toml ] && [ -f src/main.py ] || { echo "ERROR: ejecútalo en la raíz del proyecto (faltan pyproject.toml o src/main.py)"; exit 2; }
dir="src/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
pascal=$(echo "$name" | awk -F_ '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')

mkdir -p "$dir/tests" docs/specs
[ -e src/modules/__init__.py ] || : > src/modules/__init__.py
# Atomic write: a failure never leaves a half-written file.
put() {
  [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }
  local tmp; tmp=$(mktemp "$1.XXXXXX")
  printf '%s\n' "$2" > "$tmp" && mv "$tmp" "$1"
  echo "  + $1"
}
# Two-line docstrings: the contract path stays under ruff's 100-column limit for any valid name.
doc() { printf '"""%s\n\nContrato: docs/specs/%s_contract.md § %s.\n"""' "$1" "$name" "$2"; }
put "$dir/__init__.py"   ""
put "$dir/models.py"     "$(doc "Modelos SQLAlchemy de $name." data-writer)"
put "$dir/schemas.py"    "$(doc "Schemas Pydantic de entrada/salida de $name." data-writer)"
put "$dir/exceptions.py" "$(doc "Excepciones de dominio de $name." logic-writer)"
put "$dir/services.py"   "$(doc "Casos de uso de $name (sin HTTP)." logic-writer)"
put "$dir/routes.py"     "$(doc "Router HTTP de $name." web-writer)"
put "$dir/tests/__init__.py" ""
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else
  tmp=$(mktemp "$contract.XXXXXX")
  sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/contract.md" > "$tmp" && mv "$tmp" "$contract"
  echo "  + $contract"
fi
echo "scaffold OK: $name"
echo "Registro (orquestador, src/main.py dentro de create_app): from src.modules.$name.routes import router as ${name}_router; router.include(${name}_router)"
