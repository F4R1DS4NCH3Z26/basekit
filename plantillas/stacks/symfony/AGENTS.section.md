## Stack: PHP · Symfony (API REST) + Doctrine
- Servidor: FrankenPHP en Docker. Datos: Doctrine ORM + Migrations sobre `DATABASE_URL`. Auth: access tokens de Symfony Security (detalle en `symfony-patterns/references/auth.md`). Tests: PHPUnit (`WebTestCase`).
- Módulos en `src/Modules/<M>/` (namespace `App\Modules\`): `Domain/` (Entity, Repository, Enum) · `Application/` (DTO readonly, handlers, Voters) · `Http/` (controladores invocables con `#[Route]`, Request con constraints, Resource).
- `declare(strict_types=1)` en todo; entrada con `#[MapRequestPayload]`; autorización con Voters; salida con campos explícitos; recurso ajeno → 404.
- `/api/**` exige autenticación por defecto (`config/packages/security.yaml`); `/health` es público.
- Nunca ejecutes `doctrine:schema:drop`, `doctrine:database:drop` ni `doctrine:fixtures:load` contra datos reales sin que el usuario lo pida explícitamente.

| Rol | Zona |
|---|---|
| orquestador | lo común + `composer.*`, `symfony.lock`, `config/`, `bin/`, `public/`, `migrations/`, `src/Kernel.php`, `src/Core/`, `tests/bootstrap.php` |
| data-writer | `Domain/` |
| app-writer | `Application/` |
| http-writer | `Http/` |
| qa-writer | `tests/Modules/` |

Comandos: `make dev` (puerto 8000; health en `/health`) · `make test` · `make verify SCOPE=src/Modules/<M>` · `make migration NAME=x` (Doctrine diff) · `make migrate` · `make sh` y dentro `php bin/console …`
