#!/usr/bin/env bash
# Crea el esqueleto de un módulo PHP. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[A-Z][A-Za-z0-9]{1,40}$ ]] || { echo "Uso: scaffold.sh <Modulo>  (PascalCase, ej. Invoices)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f composer.json ] || { echo "ERROR: ejecútalo en la raíz del proyecto (falta composer.json)"; exit 2; }
dir="src/Modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
kebab=$(echo "$name" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr 'A-Z' 'a-z')
snake=${kebab//-/_}
# Same exact match as mongo-setup.sh and .make/stack.mk: the DB_DRIVER of the overlay infra-setup activated.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
keep=sql; drop=mongo
[ "$driver" = mongodb ] && { keep=mongo; drop=sql; }

put() { [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }; mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; echo "  + $1"; }
for d in Domain/Models Database/Migrations Database/Factories Application/Actions Application/DTOs Application/Policies \
         Http/Controllers Http/Requests Http/Resources; do put "$dir/$d/.gitkeep" ""; done
put "tests/Modules/$name/.gitkeep" ""

if [ -f artisan ]; then
put "$dir/Http/routes.php" "<?php

declare(strict_types=1);

use Illuminate\\Support\\Facades\\Route;

// Rutas de $name. Contrato: docs/specs/${kebab}_contract.md § http-writer
Route::middleware(['api', 'auth:sanctum'])->prefix('api/$kebab')->group(function (): void {
    //
});"
put "$dir/Providers/${name}ServiceProvider.php" "<?php

declare(strict_types=1);

namespace App\\Modules\\$name\\Providers;

use Illuminate\\Support\\ServiceProvider;

final class ${name}ServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        \$this->loadRoutesFrom(__DIR__.'/../Http/routes.php');
        \$this->loadMigrationsFrom(__DIR__.'/../Database/Migrations');
        // Gate::policy(Modelo::class, ModeloPolicy::class);  ← orquestador, tras el app-writer
    }
}"
fi
if [ $keep = mongo ]; then
put "$dir/Domain/Models/$name.php" "<?php

declare(strict_types=1);

namespace App\\Modules\\$name\\Domain\\Models;

use Illuminate\\Database\\Eloquent\\Concerns\\HasUuids;
use MongoDB\\Laravel\\Eloquent\\Model;

// Modelo MongoDB de $name (colección $snake, _id UUID). Los índices van en una migración de Database/Migrations
// (make migration NAME=create_${snake}_indexes) y los crea make migrate. Contrato: docs/specs/${kebab}_contract.md § data-writer
class $name extends Model
{
    use HasUuids;

    protected \$connection = 'mongodb';

    protected \$table = '$snake';

    /** @var list<string> */
    protected \$fillable = [];
}"
fi

# The contract template carries both data models between <!-- sql --> and <!-- mongo --> markers: keep this project's.
mkdir -p docs/specs; contract="docs/specs/${kebab}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else sed -e "/<!-- $drop -->/,/<!-- \/$drop -->/d" -e "/<!-- \/*$keep -->/d" \
  -e "s/__NAME__/$name/g" -e "s/__KEBAB__/$kebab/g" -e "s/__SNAKE__/$snake/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name"
[ -f artisan ] && echo "Registro (orquestador, bootstrap/providers.php): App\\Modules\\$name\\Providers\\${name}ServiceProvider::class,"
grep -q 'App\\\\Modules\\\\' composer.json || echo "AVISO: composer.json no mapea \"App\\\\Modules\\\\\": \"src/Modules/\" (orquestador + composer dump-autoload)"
