#!/usr/bin/env bash
# Crea el esqueleto de un módulo Flask. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9_]{1,40}$ ]] || { echo "Uso: scaffold.sh <modulo>  (snake_case, ej. orders)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f pyproject.toml ] && [ -f src/main.py ] || { echo "ERROR: ejecútalo en la raíz del proyecto Flask (faltan pyproject.toml o src/main.py)"; exit 2; }
dir="src/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
pascal=$(echo "$name" | awk -F_ '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')
# One MongoDB detection, the same exact match as stack.mk and mongo-setup.sh. MongoDB → PyMongo; anything else → SQL.
mongo=""
grep -Eqs '^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$' compose.db.yaml && mongo=1

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
if [ -n "$mongo" ]; then
put "$dir/models.py"     "$(doc "Colección MongoDB (PyMongo) de $name." data-writer)

from typing import Any, TypedDict

from pymongo import IndexModel
from pymongo.collection import Collection
from pymongo.database import Database

COLLECTION = \"$name\"
# Índices declarados: en dev se crean en el primer uso de la BD; en prod, con make migrate.
# Nunca se borran solos.
INDEXES: list[IndexModel] = []


class ${pascal}Document(TypedDict):
    _id: str  # UUID en texto (lo genera el servidor), como el id del contrato


def collection(db: Database[Any]) -> Collection[${pascal}Document]:
    return db[COLLECTION]"
keep=mongo; drop=sql
else
put "$dir/models.py"     "$(doc "Modelos SQLAlchemy de $name." data-writer)"
keep=sql; drop=mongo
fi
put "$dir/schemas.py"    "$(doc "Schemas Pydantic de entrada/salida de $name." data-writer)"
put "$dir/exceptions.py" "$(doc "Excepciones de dominio de $name." logic-writer)"
put "$dir/services.py"   "$(doc "Casos de uso de $name (sin Flask)." logic-writer)"
put "$dir/routes.py"     "$(doc "Blueprint HTTP de $name." web-writer)"
put "$dir/tests/__init__.py" ""
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else
  tmp=$(mktemp "$contract.XXXXXX")
  # The template carries both data models between <!-- sql --> and <!-- mongo --> markers: keep this project's.
  sed -e "/<!-- $drop -->/,/<!-- \/$drop -->/d" -e "/<!-- \/*$keep -->/d" -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" \
    "$assets/contract.md" > "$tmp" && mv "$tmp" "$contract"
  echo "  + $contract"
fi
echo "scaffold OK: $name"
echo "Registro (orquestador, src/main.py dentro de create_app): from src.modules.$name.routes import bp as ${name}_bp; app.register_blueprint(${name}_bp)"
