#!/usr/bin/env bash
# Crea el esqueleto de una app Django + HTMX en src/modules/<modulo>/. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9_]{1,40}$ ]] || { echo "Uso: scaffold.sh <modulo>  (snake_case, ej. orders)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f manage.py ] || { echo "ERROR: ejecútalo en la raíz del proyecto Django (falta manage.py)"; exit 2; }
dir="src/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
pascal=$(echo "$name" | awk -F_ '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')

mkdir -p "$dir/tests" "$dir/migrations" "$dir/templates/$name" docs/specs
[ -e src/modules/__init__.py ] || : > src/modules/__init__.py
# Atomic write: a temporary file next to the target, then mv (an interrupted run never leaves half a file).
put() {
  [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }
  local tmp; tmp=$(mktemp "$1.XXXXXX"); printf '%s\n' "$2" > "$tmp"; mv "$tmp" "$1"; echo "  + $1"
}
c="Contrato: docs/specs/${name}_contract.md"
put "$dir/__init__.py"            ""
put "$dir/models.py"              "\"\"\"Modelos del ORM de $name. $c § data-writer.\"\"\""
put "$dir/admin.py"               "\"\"\"Registro de $name en el admin. $c § data-writer.\"\"\""
put "$dir/exceptions.py"          "\"\"\"Excepciones de dominio de $name. $c § logic-writer.\"\"\""
put "$dir/services.py"            "\"\"\"Casos de uso de $name (sin HTTP ni formularios). $c § logic-writer.\"\"\""
put "$dir/forms.py"               "\"\"\"Formularios de $name (campos explícitos). $c § views-writer.\"\"\""
put "$dir/views.py"               "\"\"\"Vistas de $name: página completa o parcial HTMX. $c § views-writer.\"\"\""
put "$dir/urls.py"                "\"\"\"Rutas de $name. $c § views-writer.\"\"\"

from django.urls import URLPattern, URLResolver

app_name = \"$name\"
urlpatterns: list[URLPattern | URLResolver] = []"
put "$dir/apps.py"                "$(sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/apps.py.tpl")"
put "$dir/migrations/__init__.py" ""
put "$dir/tests/__init__.py"      ""
contract="docs/specs/${name}_contract.md"
put "$contract" "$(sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/contract.md")"
echo "  + $dir/templates/$name/ (plantillas del views-writer: <x>.html completas y _<x>.html parciales)"
echo "scaffold OK: $name"
echo "Registro (orquestador):"
echo "  src/config/settings.py → INSTALLED_APPS: \"src.modules.$name.apps.${pascal}Config\","
echo "  src/config/urls.py     → path(\"$name/\", include(\"src.modules.$name.urls\")),"
