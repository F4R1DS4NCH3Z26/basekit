# Stack: Python · Nativo (WSGI de la stdlib, sin framework) · v1

Plantillas: `plantillas/stacks/python-native/`. Etiqueta en `init`: «Python · Nativo (WSGI de la stdlib, sin framework) + SQLAlchemy 2 o PyMongo (MongoDB)». Motores (`dbs`): PostgreSQL, MySQL, SQLite y MongoDB. Tipo (`kind`): `backend`. Auth por defecto: **JWT propio** (access + refresh rotado). Puerto: 8000. Healthcheck: `/health`.

**Detección**: ninguna (`detect: {}`). Un proyecto WSGI sin framework no se distingue de forma fiable de otro proyecto Python, así que este stack solo se elige con la pregunta de `init` o con `--stack python-native`. Un `pyproject.toml` que declara `flask`, `fastapi` o `manage.py` de Django sigue detectándose como su stack.

**Qué significa «nativo»**: sin framework web (ni Flask, ni FastAPI, ni Django, ni Starlette). La capa HTTP es la interfaz WSGI de la stdlib (PEP 3333) con un router propio. Sí se usan librerías que no son framework web:

| Librería | Por qué |
|---|---|
| gunicorn | Servidor WSGI de producción (`wsgiref` de la stdlib no sirve para prod) y recarga en dev |
| SQLAlchemy 2 (Core + ORM) + Alembic | Acceso a datos con parámetros enlazados y migraciones autogeneradas |
| `psycopg[binary]`, `pymysql[rsa]` | Drivers de Postgres y MySQL (SQLite viene en la stdlib) |
| PyMongo (solo con MongoDB) | Driver oficial de MongoDB, en vez de SQLAlchemy, Alembic y los drivers SQL |
| Pydantic v2 | Solo valida datos (no es un framework web); validar a mano es donde aparecen los fallos de mass assignment |
| pytest, ruff, mypy | Herramientas de desarrollo |

La configuración no usa `pydantic-settings`: es un dataclass de la stdlib que lee `os.environ`.

## Arquitectura (módulos por entidad)

```text
pyproject.toml  uv.lock            # orquestador; dependencias con uv dentro de Docker
alembic.ini  alembic/              # orquestador; env.py importa todos los src/modules/*/models.py (no existen con MongoDB)
conftest.py                        # fixtures app, client, db (y user, auth_as con auth) (orquestador)
src/
├── main.py                        # create_app(): /health e inclusión de routers (orquestador)
├── core/
│   ├── config.py                  # Settings (dataclass desde el entorno)
│   ├── http.py                    # Request, Response, json_response, HTTPError
│   ├── router.py                  # Router: /x/{id:uuid}, 404/405
│   ├── wsgi.py                    # App: errores JSON, 422, 500 sin trazas, CORS, OPTIONS, HEAD
│   ├── db.py                      # Base, get_db(request), load_models() (MongoDB: get_db(request), create_indexes)
│   ├── create_indexes.py          # solo MongoDB: lo corre make migrate
│   ├── testing.py                 # TestClient WSGI para pytest
│   └── security.py                # con auth: require_user, require_role
└── modules/<m>/
    ├── models.py  schemas.py      # data-writer (SQLAlchemy 2 o PyMongo + Pydantic v2)
    ├── exceptions.py  services.py # logic-writer (sin HTTP)
    ├── routes.py                  # web-writer (router = Router("/m"))
    └── tests/                     # qa-writer
tests/test_*.py                    # qa-writer
```

**Esqueleto**: si falta `uv.lock` (el `appMarker`), el CLI copia `starter/` sin sobrescribir lo que ya exista; después, `make new-app` genera `uv.lock`.
- `pyproject.toml` con versiones exactas (SQLAlchemy 2.1, Alembic, Pydantic v2, gunicorn, `psycopg[binary]`, `pymysql[rsa]`), ruff (incluidas las reglas de seguridad `S`), mypy strict y pytest.
- `src/core/http.py`: `Request` con `json()` (vacío → `None`; otro `Content-Type` → 415; JSON roto → 400), `query`, `header()` y cuerpo máximo de 1 MiB (413, también con `Transfer-Encoding: chunked`).
- `src/core/router.py`: rutas con convertidores `str`, `int` y `uuid` (un valor que no convierte es 404); método no permitido → 405 con `Allow`.
- `src/core/wsgi.py`: errores siempre en JSON (`ValidationError` → 422 sin eco de la entrada; 500 sin trazas, con el detalle en el log), CORS a partir de `CORS_ORIGINS`, `OPTIONS`, `HEAD` y `X-Content-Type-Options: nosniff`.
- `src/core/config.py`, que normaliza `DATABASE_URL` → `postgresql+psycopg://`, `mysql+pymysql://` o `sqlite:///` (`/app/data/app.db`).
- `src/core/db.py`: `Base`, engine creado en el primer uso, `get_db(request)` con una sesión por petición que se cierra al terminar la petición, y `load_models()`, que importa todos los `src/modules/*/models.py` (la app, `conftest.py` y `alembic/env.py` lo llaman: una FK entre módulos solo resuelve con las dos tablas cargadas).
- `alembic.ini` + `alembic/` listos: `make migrate` funciona sin migraciones y `make migration NAME=x` autogenera.
- `conftest.py` y `tests/test_health.py` sobre SQLite en memoria.

### MongoDB: PyMongo

El esqueleto es SQL porque `init` lo copia antes de que infra-setup active la BD. Con `--db mongo` (`DB_DRIVER: mongodb` en `compose.db.yaml`), `make new-app` corre primero `pynative-scaffold/scripts/mongo-setup.sh` (sin red; con otra BD no hace nada) y después `uv lock`. Si falta el script en un proyecto con MongoDB, `make new-app` se detiene antes de `uv lock`; en uno SQL sigue igual. El script:
- Solo reemplaza archivos del esqueleto intactos (los compara con el `cksum` del esqueleto). Si `pyproject.toml`, `src/core/config.py`, `src/core/db.py`, `src/core/wsgi.py`, `src/main.py`, `conftest.py`, `alembic.ini` o algo dentro de `alembic/` ya no es el del esqueleto, se detiene con `ERROR: estos archivos ya no son los del esqueleto de basekit y no se sobrescriben:`, los lista y no cambia nada. Si `alembic/versions` tiene migraciones, se detiene igual.
- Deriva `pyproject.toml` del del esqueleto: `pymongo==4.19.0` ocupa la línea de SQLAlchemy, se van Alembic, `psycopg`, `pymysql` y sus ajustes de ruff y mypy, y agrega para los tests `mongomock==4.3.0` (con su override de mypy, porque no trae tipos).
- Borra `alembic/` y `alembic.ini`.
- `src/core/config.py`: `mongo_url` (de `MONGO_URL`, que el overlay inyecta con el usuario de la app).
- `src/core/db.py`: `declared_indexes()` (`COLLECTION` e `INDEXES` de todos los `src/modules/*/models.py`), `create_indexes()` (`create_indexes` de PyMongo: crea los que falten, nunca borra), `mongo_client()` (sin `MONGO_URL` falla con `MONGO_URL no está definida …`), `default_database()` y `get_db(request)`. El cliente se crea en el primer uso, no al importar: `/health` no toca la BD y `make verify` corre sin ella. En dev, ese primer uso crea los índices declarados que falten; en prod no.
- `src/core/wsgi.py`: `App(router, cors, database=None)` deja en cada petición la base de datos de los tests (o None, y entonces `get_db` usa la de `MONGO_URL`).
- `src/core/create_indexes.py`: lo corre `make migrate` (también `ENV=prod`). Hace `ping`, crea los índices declarados que falten e imprime cuántos tiene cada colección. Nunca borra uno: quitar un índice de `INDEXES` no lo quita de la BD. Para borrarlo, `make db-shell` (`ENV=prod` en producción), `db.<colección>.getIndexes()` y `db.<colección>.dropIndex('<nombre>')`.
- `src/main.py`: `create_app(database=None)`; los tests pasan la base de datos en memoria.
- `conftest.py`: `db` es una base de datos en memoria (mongomock), nueva en cada test y con los índices declarados; `app` y `client` la usan. `make test` y `make verify` no necesitan MongoDB.
- Es idempotente: un archivo que ya tiene la variante PyMongo se conserva. Para pasar a MongoDB después de `make new-app`: activa la BD con infra-setup, borra `uv.lock` y vuelve a correr `make new-app`.

Por módulo, `scaffold.sh` escribe en `models.py` `COLLECTION` (= el módulo), `INDEXES`, un `TypedDict` `<Pascal>Document` con `_id` UUID en texto y `collection(db)`, y deja en el contrato la sección de la colección (sin la tabla SQL). Los services reciben la base de datos en vez de la sesión. `make migration` solo explica que MongoDB no tiene migraciones.

Redis llega por `REDIS_URL` (y `REDIS_PASSWORD`) desde su overlay; `Settings.redis_url` lo expone. El cliente (`redis`) se agrega con `make deps-add` cuando haga falta.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `pyproject.toml`, `uv.lock`, `src/core/**`, `src/main.py`, `src/__init__.py`, `alembic.ini`, `alembic/**`, `conftest.py`, `__init__.py` de módulos |
| data-writer | `models.py`, `schemas.py` |
| logic-writer | `services.py`, `exceptions.py` |
| web-writer | `routes.py` |
| qa-writer | `src/modules/*/tests/test_*.py`, `tests/test_*.py`, `tests/**/test_*.py` |

Skills: `pynative-scaffold`, `pynative-verify` (la usa `make verify`), `pynative-patterns` (+ `references/auth.md`).

## Docker

| Target | Uso |
|---|---|
| `dev` | `uv sync --frozen` (con dependencias dev) en `/opt/venv`; `gunicorn --reload` con 1 worker |
| `deps-prod` → `prod` | `uv sync --frozen --no-dev`; imagen limpia con el venv copiado, gunicorn (2 workers, `--no-control-socket`, `--worker-tmp-dir /tmp`), usuario `app` (1001), `read_only` + `tmpfs`, `cap_drop: [ALL]`, healthcheck con `urllib` |

- **gunicorn también en dev**: `wsgiref.simple_server` no recarga ni es apto para producción. En dev también va `--no-control-socket`, para que el socket de control no aparezca en el bind mount.
- **El venv vive en `/opt/venv`**, fuera del bind mount: `make install` reconstruye la imagen.
- **`make new-app`** genera `uv.lock` con `ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim`; si `uv.lock` ya existe, no hace nada (ni llama a Docker). Con MongoDB aplica antes la variante PyMongo.
- **`make deps-add PKGS="…" [DEV=1]`** ejecuta `uv add` dentro de Docker y reconstruye.
- **`migrate`** ejecuta `alembic upgrade head` con el target del entorno (en prod también `read_only`). Por eso **Alembic y los drivers son dependencias de runtime**. Con MongoDB ejecuta `python -m src.core.create_indexes` (en prod como el usuario `app`). Sin `alembic.ini` ni `src/core/create_indexes.py` falla: `ERROR: sin alembic.ini (SQLAlchemy) ni src/core/create_indexes.py (MongoDB) no hay migraciones que aplicar: ejecuta make new-app`.

## Auth: JWT (detalle en `pynative-patterns/references/auth.md`)

1. Dependencias: `make deps-add PKGS="pyjwt pwdlib[argon2] email-validator"` con versiones exactas de ≥ 14 días.
2. `core/security.py`:
   - argon2id con `pwdlib`.
   - `ALGORITHM = "HS256"` fijo.
   - Decodificación con `algorithms=[…]`, `audience`, `issuer` y `require` de `exp`, `sub`, `iss` y `aud`.
   - Sin decoradores: `user = require_user(request)` al inicio de cada handler protegido (401 con `WWW-Authenticate: Bearer`) y `require_role(request, "admin")` (403).
   - Un `DUMMY_HASH` para que el login tarde lo mismo exista o no el usuario.
3. Módulo `auth`:
   - Tablas `User` y `RefreshToken` (`token_hash`, `family_id`, `expires_at`, `revoked_at`).
   - `rotate()`: si se presenta un refresh ya rotado, revoca toda la familia.
   - Endpoints `/auth/register`, `/login`, `/refresh`, `/logout`, `/me`.
4. Si el cliente es un navegador, el refresh viaja en cookie (`http.cookies.SimpleCookie`) `httponly` + `secure` + `samesite=Lax`. El rate limit va en el proxy o en un contador propio en Redis.
5. Variables: `JWT_SECRET=__GENERATE__` (32+ caracteres; `Settings` lo exige al arrancar cuando hay auth), `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES=15`, `REFRESH_TOKEN_DAYS=14`. No hay `SECRET_KEY`: sin framework no hay sesiones firmadas.

## Comandos

```bash
make dev
make test
make verify SCOPE=src/modules/<m>
make migration NAME=x        # autogenerate de Alembic; con MongoDB solo explica que no hay migraciones
make migrate                 # Alembic: migraciones; MongoDB: crea los índices declarados (nunca borra)
make deps-add PKGS="…"
```

## Seguridad específica

- **Entrada y salida**: schemas Pydantic con `extra="forbid"` en la entrada; la salida pasa siempre por el schema de lectura.
- **Cuerpo**: máximo 1 MiB (413); solo `application/json` (415).
- **SQL**: solo con ORM o `text(":param")`.
- **MongoDB**: filtros armados en services con valores validados por Pydantic; nunca un dict del cliente dentro de un filtro (inyección NoSQL con `$ne`, `$gt`…) ni `$where`.
- **Autorización por recurso**: en services; un recurso ajeno responde 404.
- **Paginación**: `le=100`.
- **Funciones prohibidas** sobre datos de entrada: `eval`, `pickle.loads`, `yaml.load`, plantillas con `str.format` o `string.Template` del cliente y `shell=True`.
- **CORS**: orígenes explícitos, nunca `*` con credenciales.
- **Errores**: un 500 nunca devuelve la traza; va al log de gunicorn.

## Errores comunes

- Agregar un framework web «para ir más rápido»: rompe el contrato del stack.
- Services que reciben `Request` o lanzan `HTTPError`.
- Devolver `json_response(modelo.__dict__)` en vez del schema de lectura.
- Leer `X-Forwarded-For` tal cual llega para el rate limit.
- Dos agentes editando `main.py`.
- Crear el engine al importar: rompe los tests y los comandos sin base de datos.
- Alembic como dependencia de desarrollo: `make prod-migrate` falla.
- Instalar paquetes con `pip` en el host.
- Con MongoDB, guardar un `Decimal`: PyMongo no lo codifica (`InvalidDocument`). Guarda `Decimal128(valor)` y conviértelo en el schema de lectura (ver `pynative-patterns`).
