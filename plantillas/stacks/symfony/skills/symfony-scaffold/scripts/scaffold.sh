#!/usr/bin/env bash
# Crea el esqueleto de un módulo Symfony. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[A-Z][A-Za-z0-9]{1,40}$ ]] || { echo "Uso: scaffold.sh <Modulo>  (PascalCase, ej. Invoices)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f composer.json ] || { echo "ERROR: ejecútalo en la raíz del proyecto (falta composer.json; ¿corriste make new-app?)"; exit 2; }
dir="src/Modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
kebab=$(echo "$name" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr 'A-Z' 'a-z')
snake=${kebab//-/_}
# Same exact match as mongo-setup.sh and .make/stack.mk: the DB_DRIVER of the overlay infra-setup activated.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
keep=sql; drop=mongo
[ "$driver" = mongodb ] && { keep=mongo; drop=sql; }

put() { [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }; mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; echo "  + $1"; }
for d in Domain/Entity Domain/Repository Domain/Enum Application/DTO Application/Handler Application/Security \
         Http/Controller Http/Request Http/Resource; do put "$dir/$d/.gitkeep" ""; done
put "tests/Modules/$name/.gitkeep" ""
if [ $keep = mongo ]; then
put "$dir/Domain/Entity/$name.php" "<?php

declare(strict_types=1);

namespace App\\Modules\\$name\\Domain\\Entity;

use Doctrine\\ODM\\MongoDB\\Mapping\\Attribute as ODM;
use Symfony\\Component\\Uid\\Uuid;

// Documento MongoDB de $name (colección $snake, _id UUID). Los índices se declaran aquí (#[ODM\\Index]) y los crea
// make migrate. Contrato: docs/specs/${kebab}_contract.md § data-writer
#[ODM\\Document(collection: '$snake')]
class $name
{
    #[ODM\\Id(type: 'string', strategy: 'NONE')]
    private string \$id;

    public function __construct()
    {
        \$this->id = Uuid::v7()->toRfc4122();
    }

    public function getId(): string
    {
        return \$this->id;
    }
}
"
fi

# The contract template carries both data models between <!-- sql --> and <!-- mongo --> markers: keep this project's.
mkdir -p docs/specs; contract="docs/specs/${kebab}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else
  tmp=$(mktemp "docs/specs/.contract.XXXXXX")
  sed -e "/<!-- $drop -->/,/<!-- \/$drop -->/d" -e "/<!-- \/*$keep -->/d" -e "s/__NAME__/$name/g" -e "s/__KEBAB__/$kebab/g" -e "s/__SNAKE__/$snake/g" "$assets/contract.md" > "$tmp"
  mv "$tmp" "$contract"; echo "  + $contract"
fi
echo "scaffold OK: $name"
grep -q '"App\\\\": "src/"' composer.json || echo "AVISO: composer.json no mapea \"App\\\\\": \"src/\" (orquestador + composer dump-autoload)"
