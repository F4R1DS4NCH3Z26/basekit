---
name: infra-setup
description: Activa la base de datos (PostgreSQL, MySQL, SQLite o MongoDB) y/o Redis de un proyecto creado con basekit, agregando el overlay de Docker Compose, las variables a .env.example y el acceso con make db-shell. Úsala SIEMPRE después de decidir en el bootstrap (o en una ADR) qué persistencia necesita el proyecto, en lugar de editar compose a mano.
allowed-tools: Bash(bash .agents/skills/infra-setup/scripts/infra.sh:*)
---

# infra-setup

```bash
bash .agents/skills/infra-setup/scripts/infra.sh --db postgres            # o mysql | sqlite | mongo | none
bash .agents/skills/infra-setup/scripts/infra.sh --db postgres --redis    # + Redis
```

El script trabaja en el proyecto que lo contiene (la carpeta de su `.agents/`), desde cualquier directorio. En un proyecto combinado la base de datos es del backend: usa su copia, `bash backend/.agents/skills/infra-setup/scripts/infra.sh --db postgres`.

Qué hace:
- Copia el overlay a `compose.db.yaml` y, con `--redis`, a `compose.redis.yaml`. El `Makefile` incluye los overlays automáticamente si existen.
- Agrega a `.env.example` un bloque marcado (`# >>> db`) con secretos `__GENERATE__`, que `make env` reemplaza por valores aleatorios.
- Inyecta la conexión en el contenedor `app` en todos los formatos habituales, para que funcione en cualquier stack sin cambios:
  - `DATABASE_URL` (Prisma, Drizzle, SQLAlchemy).
  - `DB_HOST`, `DB_PORT`, `DB_DATABASE`… (Laravel).
  - `SPRING_DATASOURCE_*` (Spring).
  - Con MongoDB: `DATABASE_URL` y `MONGO_URL` (`mongodb://…?authSource=<DB_NAME>`), y `SPRING_DATA_MONGODB_URI`.
- Con MongoDB hay dos usuarios:
  - `root`, con `DB_ROOT_PASSWORD`, solo para administrar;
  - el de la app, `DB_USER`/`DB_PASSWORD`, con `readWrite` solo en `DB_NAME`. Es el de las URLs, el healthcheck y `make db-shell`.
  - El usuario de la app lo crea un script de inicio que va dentro del mismo overlay (`configs` de Compose; necesita Docker Compose 2.23.1 o posterior). Corre solo en el primer arranque de un volumen vacío: un volumen creado por el overlay anterior necesita el paso de [Volumen MongoDB anterior](#volumen-mongodb-anterior).
- La base de datos **no publica puertos** al host. Para entrar, usa `make db-shell` (`mongosh` con MongoDB).
- Solo deja la conexión: no crea tablas, colecciones ni datos. Con MongoDB, NestJS trae la integración con Mongoose (`@nestjs/mongoose`); los demás stacks ofrecen `mongo` solo cuando su `stack.json` lo lista en `dbs`.
- Sin `Makefile` (proyecto solo con Docker) no escribe `.make/`: copia `.env.example` a `.env` y reemplaza los `__GENERATE__` a mano.

Es idempotente y no reemplaza un overlay modificado a mano sin `--force`. Si `.env` ya existe, avisa qué variables agregar: nunca toca secretos.

Después:
1. `make env` (si no hay `.env`) → `make dev`.
2. Configura la conexión en la app según la skill `<stack>-patterns` (sección base de datos de su `references/auth.md` o del patrón de modelos).
3. Registra la decisión en una ADR (`docs/adr/NNNN-base-de-datos.md`) y en la tabla de `docs/PROJECT.md`.

## Volumen MongoDB anterior

Aplica a los proyectos cuyo volumen de MongoDB (`db-data`) se creó antes del usuario de la app, con el overlay anterior (sus URLs dicen `authSource=admin`). En ese volumen el root es `DB_USER`/`DB_PASSWORD` en `admin` y no existe el usuario de la app en `DB_NAME`. Con el overlay nuevo, el healthcheck y las URLs autentican contra `DB_NAME`, así que `db` no pasa a `healthy` y `make dev` falla con `dependency failed to start`. El script de inicio no vuelve a correr porque el volumen no está vacío.

En desarrollo, si los datos no importan, basta `make clean CONFIRM=1` (borra los datos locales). Para conservarlos, desde la raíz del proyecto y con `.env` sin cambios:
1. `infra.sh --force` pone el overlay nuevo y agrega `DB_ROOT_PASSWORD` a `.env.example`; `make env` lo agrega a `.env`.
2. `dc` es el comando de Compose que usa el `Makefile` en desarrollo; `dc up -d db` levanta solo la base de datos y el bucle espera a que `mongod` acepte conexiones (`ping` no pide usuario; el healthcheck todavía falla porque falta el usuario de la app).
3. El primer `mongosh`, con el root anterior (`DB_USER` en `admin`), crea el usuario de la app en `DB_NAME` y el root nuevo con `DB_ROOT_PASSWORD`.
4. `dc up -d --wait db` espera a que `db` esté `healthy` (ya existe el usuario de la app) y el segundo `mongosh`, con el root nuevo, borra el root anterior: tiene la misma contraseña que la app.

```bash
bash .agents/skills/infra-setup/scripts/infra.sh --db mongo --force
make env
dc() { docker compose -p "$(make -s _compose-project)" --env-file .env -f compose.yaml -f compose.dev.yaml -f compose.db.yaml "$@"; }
dc up -d db
until dc exec -T db mongosh --quiet --eval 'db.adminCommand("ping").ok' >/dev/null 2>&1; do sleep 1; done
dc exec -T db mongosh --quiet --eval '
  const name = process.env.MONGO_INITDB_DATABASE, user = process.env.MONGO_APP_USERNAME, pwd = process.env.MONGO_APP_PASSWORD;
  const admin = db.getSiblingDB("admin");
  admin.auth(user, pwd);
  db.getSiblingDB(name).createUser({ user, pwd, roles: [{ role: "readWrite", db: name }] });
  admin.createUser({ user: "root", pwd: process.env.MONGO_INITDB_ROOT_PASSWORD, roles: ["root"] });'
dc up -d --wait db
dc exec -T db mongosh --quiet --eval '
  const admin = db.getSiblingDB("admin");
  admin.auth("root", process.env.MONGO_INITDB_ROOT_PASSWORD);
  admin.dropUser(process.env.MONGO_APP_USERNAME);'
make dev
```

En producción es lo mismo con `make env ENV=prod` y `dc() { docker compose --env-file .env.prod -f compose.yaml -f compose.prod.yaml -f compose.db.yaml "$@"; }`.
