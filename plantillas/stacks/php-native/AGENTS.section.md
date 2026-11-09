## Stack: PHP · Nativo (PDO, sin framework)
- Servidor: FrankenPHP (`php-server`) en Docker. Sin framework: front controller `public/index.php`, router y contenedor propios en `src/Core/`. Datos: PDO + migraciones SQL propias (`bin/migrate.php`, tabla `schema_migrations`). Auth: tokens bearer opacos (detalle en `phpnative-patterns/references/auth.md`). Tests: PHPUnit con `tests/Support/AppTestCase.php` (Kernel real, SQLite en memoria).
- Módulos en `src/Modules/<M>/` (namespace `App\Modules\`): `Migrations/` (SQL portable `<YYYYMMDDHHMMSS>_<nombre>.sql` y variantes `.pgsql|.mysql|.sqlite.sql`) · `Domain/` (Entity con `fromRow`, Repository PDO, Enum) · `Application/` (DTO readonly, handlers, Policies) · `Http/` (`routes.php`, controladores invocables, Input, Resource).
- `declare(strict_types=1)` en todo; SQL solo con `prepare()` y parámetros; entrada con `App\Core\Http\Input`; salida con campos explícitos; recurso ajeno → 404.
- Toda ruta exige autenticación salvo `public: true` (`/health` es pública). `src/Core/` es del orquestador.
- Nunca edites una migración ya aplicada ni ejecutes `DROP`/`TRUNCATE` contra datos reales sin que el usuario lo pida explícitamente.

| Rol | Zona |
|---|---|
| orquestador | lo común + `composer.*`, `bin/`, `public/`, `migrations/`, `src/Core/`, `tests/bootstrap.php`, `tests/Core/`, `tests/Support/` |
| data-writer | `Domain/`, `Migrations/` |
| app-writer | `Application/` |
| http-writer | `Http/` |
| qa-writer | `tests/Modules/` |

Comandos: `make new-app` (genera `composer.lock`) · `make dev` (puerto 8000; health en `/health`) · `make test` · `make verify SCOPE=src/Modules/<M>` · `make module-migration M=<M> NAME=x` · `make migration NAME=x` (global) · `make migrate` · `make sh` y dentro `php bin/migrate.php status`
