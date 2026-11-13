---
name: php-scaffold
description: Crea la estructura de un módulo nuevo de PHP (src/Modules/<Modulo>/ con Domain, Database, Application, Http, Providers; en Laravel también el ServiceProvider y routes.php) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo en Laravel, Symfony o PHP nativo, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/php-scaffold/scripts/scaffold.sh:*)
---

# php-scaffold

```bash
bash .agents/skills/php-scaffold/scripts/scaffold.sh <Modulo>   # PascalCase plural: Invoices, Customers
```

- Crea las carpetas de capa y `tests/Modules/<Modulo>/`, más `docs/specs/<modulo>_contract.md` desde `assets/contract.md`.
- Si hay `artisan` (Laravel), también genera `Providers/<Modulo>ServiceProvider.php` (carga rutas y migraciones) y `Http/routes.php` con `auth:sanctum` por defecto: seguro por omisión; cambia el guard si usas otro.
- Con MongoDB (`compose.db.yaml` con `DB_DRIVER: mongodb`) también genera `Domain/Models/<Modulo>.php` (modelo de laravel-mongodb, `_id` UUID) y el contrato trae la colección en vez de la tabla.
- No sobrescribe nada.

## MongoDB en la app (`scripts/mongo-setup.sh`)

`make new-app` lo ejecuta después de crear la app cuando el overlay es MongoDB; con otra BD no se ejecuta. Si activas MongoDB más tarde, ejecútalo tú: `bash .agents/skills/php-scaffold/scripts/mongo-setup.sh`.
- Agrega la extensión PECL `mongodb` fijada a la línea `install-php-extensions` del `Dockerfile`, la conexión `mongodb` (desde `MONGO_URL`) a `config/database.php`, los stubs de `make migration` en `stubs/` (migraciones que solo crean índices) y `mongodb/laravel-mongodb` y `mongodb/mongodb` con versión exacta en `composer.json`.
- Es idempotente. Nunca pisa un archivo que cambiaste: si el `Dockerfile` no tiene la línea del kit, `config/database.php` no tiene `'connections' => [` o un stub ya existe con otro contenido, se detiene sin cambiar nada y dice qué hacer.

Después del scaffold (orquestador):
1. Registra el provider en `bootstrap/providers.php` (Laravel 11+); el script imprime la línea.
2. Llena el contrato con el usuario y márcalo `Estado: cerrado`.
3. Tras el app-writer, registra la Policy en el provider (`Gate::policy(...)`).
