#!/usr/bin/env bash
# Crea el esqueleto de un módulo PHP nativo. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[A-Z][A-Za-z0-9]{1,40}$ ]] || { echo "Uso: scaffold.sh <Modulo>  (PascalCase, ej. Invoices)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f composer.json ] && [ -d src/Core ] || { echo "ERROR: ejecútalo en la raíz del proyecto (falta composer.json o src/Core; ¿corriste npx --no-install basekit init?)"; exit 2; }
dir="src/Modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
kebab=$(echo "$name" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr 'A-Z' 'a-z')
snake=${kebab//-/_}
# Same exact match as mongo-setup.sh and .make/stack.mk: the DB_DRIVER of the overlay infra-setup activated.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
keep=sql; drop=mongo
[ "$driver" = mongodb ] && { keep=mongo; drop=sql; }

put() { # ruta contenido: escribe en un temporal del mismo directorio y lo mueve (nunca queda a medias)
  [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }
  mkdir -p "$(dirname "$1")"
  # chmod 644: mktemp creates 0600 files, which the prod image's non-root user (uid 1001) could not read.
  local tmp; tmp=$(mktemp "$(dirname "$1")/.scaffold.XXXXXX"); printf '%s' "$2" > "$tmp"; chmod 644 "$tmp"; mv "$tmp" "$1"; echo "  + $1"
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
if [ $keep = mongo ]; then
put "$dir/Migrations/indexes.php" "<?php

declare(strict_types=1);

// MongoDB indexes of the $name module (data-writer): collection => list of createIndexes specs. make migrate creates
// the missing ones (bin/mongo-indexes.php) and never drops one. Contrato: docs/specs/${kebab}_contract.md § data-writer
return [
    '$snake' => [
        // ['key' => ['owner_id' => 1]],
    ],
];
"
put "$dir/Domain/Repository/${name}Repository.php" "<?php

declare(strict_types=1);

namespace App\\Modules\\$name\\Domain\\Repository;

use App\\Core\\Database\\Mongo;
use MongoDB\\Collection;

// Data access of $name on MongoDB (collection $snake, _id = App\\Core\\Uuid::v7()). Contrato: docs/specs/${kebab}_contract.md § data-writer
final class ${name}Repository
{
    private readonly Collection \$collection;

    public function __construct(Mongo \$mongo)
    {
        \$this->collection = \$mongo->collection('$snake');
    }

    /**
     * The owner's document, or null when it does not exist or belongs to someone else (the controller answers 404).
     * Filters only take validated scalars, never an array from the client (NoSQL injection).
     *
     * @return array<mixed>|null
     */
    public function findOwnedBy(string \$id, string \$ownerId): ?array
    {
        \$document = \$this->collection->findOne(['_id' => \$id, 'owner_id' => \$ownerId]);

        return is_array(\$document) ? \$document : null;
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
