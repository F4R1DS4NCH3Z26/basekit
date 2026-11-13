---
name: phpnative-scaffold
description: "Crea la estructura de un módulo nuevo de la API PHP nativa (src/Modules/<Modulo>/ con Domain, Application, Http, Migrations y routes.php) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo de la API, antes de escribir código o contrato a mano."
allowed-tools: Bash(bash .agents/skills/phpnative-scaffold/scripts/scaffold.sh:*)
---

# phpnative-scaffold

```bash
bash .agents/skills/phpnative-scaffold/scripts/scaffold.sh <Modulo>   # PascalCase plural: Invoices, Customers
```

- Crea las carpetas de capa (`Domain/{Entity,Repository,Enum}`, `Application/{DTO,Handler,Security}`, `Http/{Controller,Input,Resource}`, `Migrations/`), `Http/routes.php` vacío y `tests/Modules/<Modulo>/`, más `docs/specs/<modulo>_contract.md` desde `assets/contract.md`.
- No hay registro: el Kernel carga `src/Modules/*/Http/routes.php`, el Container autowirea repositorios, handlers y controladores, y el migrador lee `src/Modules/*/Migrations/*.sql`.
- Las rutas exigen autenticación salvo `public: true`: seguro por omisión.
- Con MongoDB (`compose.db.yaml` con `DB_DRIVER: mongodb`) también genera `Migrations/indexes.php` (los índices de la colección) y `Domain/Repository/<Modulo>Repository.php` sobre `App\Core\Database\Mongo`, y el contrato trae la colección en vez de la tabla.
- No sobrescribe nada.

`scripts/mongo-setup.sh` lo ejecuta `make new-app` antes de generar `composer.lock` cuando el overlay es MongoDB. Agrega:
- la extensión PECL `mongodb` fijada a la línea `install-php-extensions` del `Dockerfile`;
- `mongodb/mongodb` (versión exacta) y `ext-mongodb` a `composer.json`;
- `src/Core/Database/Mongo.php` (conexión desde `MONGO_URL` y `DB_DATABASE`);
- `bin/mongo-indexes.php` (lo usa `make migrate`).

Es idempotente y nunca pisa un archivo cambiado: si no reconoce la línea del `Dockerfile` o la sección `require` de `composer.json`, o uno de esos archivos ya existe con otro contenido, se detiene sin cambiar nada y dice qué hacer.

Después del scaffold (orquestador):
1. Llena el contrato con el usuario y márcalo `Estado: cerrado`.
2. Tras el data-writer: revisa las migraciones de `src/Modules/<Modulo>/Migrations/` y `make migrate`. Con MongoDB, `make migrate` crea los índices de `Migrations/indexes.php`.
