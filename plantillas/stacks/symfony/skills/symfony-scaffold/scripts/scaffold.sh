#!/usr/bin/env bash
# Crea el esqueleto de un módulo Symfony. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[A-Z][A-Za-z0-9]{1,40}$ ]] || { echo "Uso: scaffold.sh <Modulo>  (PascalCase, ej. Invoices)"; exit 2; }
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
[ -f composer.json ] || { echo "ERROR: ejecútalo en la raíz del proyecto (falta composer.json; ¿corriste make new-app?)"; exit 2; }
dir="src/Modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
kebab=$(echo "$name" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr 'A-Z' 'a-z')
snake=${kebab//-/_}

put() { [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }; mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; echo "  + $1"; }
for d in Domain/Entity Domain/Repository Domain/Enum Application/DTO Application/Handler Application/Security \
         Http/Controller Http/Request Http/Resource; do put "$dir/$d/.gitkeep" ""; done
put "tests/Modules/$name/.gitkeep" ""

mkdir -p docs/specs; contract="docs/specs/${kebab}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else
  tmp=$(mktemp "docs/specs/.contract.XXXXXX")
  sed -e "s/__NAME__/$name/g" -e "s/__KEBAB__/$kebab/g" -e "s/__SNAKE__/$snake/g" "$assets/contract.md" > "$tmp"
  mv "$tmp" "$contract"; echo "  + $contract"
fi
echo "scaffold OK: $name"
grep -q '"App\\\\": "src/"' composer.json || echo "AVISO: composer.json no mapea \"App\\\\\": \"src/\" (orquestador + composer dump-autoload)"
