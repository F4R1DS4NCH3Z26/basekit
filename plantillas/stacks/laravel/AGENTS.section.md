## Stack: PHP · Laravel (monolito modular)
- Servidor: FrankenPHP en Docker. Auth: Sanctum (cookie para SPA del mismo dominio, tokens para móvil), más Fortify para los flujos de cuenta. Tests: Pest o PHPUnit.
- Módulos en `src/Modules/<M>/` (namespace `App\Modules\`): `Domain/` · `Database/` · `Application/` (Actions, DTOs readonly, Policies) · `Http/` (controladores invocables, FormRequests, Resources, `routes.php`) · `Providers/`.
- `declare(strict_types=1)` en todo; `$fillable` explícito; `authorize()` vía Policy; Resources con campos explícitos.
- Nunca ejecutes `migrate:fresh`, `db:wipe` ni `tinker` sin que el usuario lo pida explícitamente.

| Rol | Zona |
|---|---|
| orquestador | lo común + `composer.*`, `config/`, `bootstrap/`, `routes/`, `Providers/`, `tests/Pest.php` |
| data-writer | `Domain/`, `Database/` |
| app-writer | `Application/` |
| http-writer | `Http/` |
| qa-writer | `tests/Modules/` |

Comandos: `make dev` (puerto 8000; health en `/up`) · `make test` · `make verify SCOPE=src/Modules/<M>` · `make migrate` · `make sh` y dentro `php artisan …`
