#!/usr/bin/env bash
# Crea el esqueleto de un módulo PHP. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[A-Z][A-Za-z0-9]{1,40}$ ]] || { echo "Uso: scaffold.sh <Modulo>  (PascalCase, ej. Invoices)"; exit 2; }
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
[ -f composer.json ] || { echo "ERROR: ejecútalo en la raíz del proyecto (falta composer.json)"; exit 2; }
dir="src/Modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
kebab=$(echo "$name" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr 'A-Z' 'a-z')
snake=${kebab//-/_}

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

mkdir -p docs/specs; contract="docs/specs/${kebab}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else sed -e "s/__NAME__/$name/g" -e "s/__KEBAB__/$kebab/g" -e "s/__SNAKE__/$snake/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name"
[ -f artisan ] && echo "Registro (orquestador, bootstrap/providers.php): App\\Modules\\$name\\Providers\\${name}ServiceProvider::class,"
grep -q 'App\\\\Modules\\\\' composer.json || echo "AVISO: composer.json no mapea \"App\\\\Modules\\\\\": \"src/Modules/\" (orquestador + composer dump-autoload)"
