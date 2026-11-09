#!/usr/bin/env bash
# Crea el esqueleto de un módulo PHP nativo. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[A-Z][A-Za-z0-9]{1,40}$ ]] || { echo "Uso: scaffold.sh <Modulo>  (PascalCase, ej. Invoices)"; exit 2; }
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
[ -f composer.json ] && [ -d src/Core ] || { echo "ERROR: ejecútalo en la raíz del proyecto (falta composer.json o src/Core; ¿corriste npx --no-install basekit init?)"; exit 2; }
dir="src/Modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
kebab=$(echo "$name" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr 'A-Z' 'a-z')
snake=${kebab//-/_}

put() { # ruta contenido: escribe en un temporal del mismo directorio y lo mueve (nunca queda a medias)
  [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }
  mkdir -p "$(dirname "$1")"
  local tmp; tmp=$(mktemp "$(dirname "$1")/.scaffold.XXXXXX"); printf '%s' "$2" > "$tmp"; mv "$tmp" "$1"; echo "  + $1"
}
for d in Domain/Entity Domain/Repository Domain/Enum Application/DTO Application/Handler Application/Security \
         Http/Controller Http/Input Http/Resource Migrations; do put "$dir/$d/.gitkeep" ""; done
put "$dir/Http/routes.php" "<?php

declare(strict_types=1);

use App\\Core\\Http\\Router;

// Routes of the $name module (http-writer). Every route needs authentication unless it passes public: true.
return static function (Router \$r): void {
    // \$r->get('/api/$kebab/{id}', \\App\\Modules\\$name\\Http\\Controller\\Show${name}Controller::class);
};
"
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
