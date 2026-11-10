# Stack: Python · FastAPI · v3

Plantillas: `plantillas/stacks/fastapi/`. Auth por defecto: **JWT propio** (access + refresh rotado). Puerto: 8000. Healthcheck: `/health`. Docs: `/docs` (desactivadas en prod).

## Arquitectura (módulos por entidad)

```text
pyproject.toml  uv.lock            # orquestador; dependencias con uv dentro de Docker
alembic/  alembic.ini              # orquestador
src/
├── main.py                        # create_app(): CORS, /health, registro de routers (orquestador)
├── core/  config.py  db.py  security.py   # db.py: Base, get_db, load_models
└── modules/<m>/
    ├── models.py  schemas.py      # data-writer
    ├── exceptions.py  services.py # logic-writer (sin HTTP)
    ├── router.py                  # web-writer
    └── tests/                     # qa-writer
conftest.py                        # fixtures app, client, db (y user, auth_as con auth) en la raíz (orquestador)
tests/test_*.py                    # qa-writer
```

**Esqueleto**: si falta `pyproject.toml`, el CLI copia `starter/`:
- `pyproject.toml` con versiones exactas (al menos 14 días): FastAPI, pydantic-settings, SQLAlchemy 2, Alembic y los drivers (`psycopg[binary]`, `pymysql[rsa]`) como runtime; pytest, ruff (incluidas las reglas de seguridad `S`), mypy strict y httpx como desarrollo.
- `src/main.py` con `create_app()`: `/health` y CORS a partir de `CORS_ORIGINS`.
- `src/core/config.py`, que normaliza `DATABASE_URL` → `postgresql+psycopg://`, `mysql+pymysql://` o `sqlite:///`.
- `src/core/db.py`: `Base`, `get_db()` (engine perezoso: la app arranca sin BD) y `load_models()`, que importa todos los `src/modules/*/models.py`. Una FK entre módulos (`products.owner_id → users.id`) solo resuelve si las dos tablas están en `Base.metadata`, así que `create_app()`, el `conftest.py` y `alembic/env.py` la llaman antes de usar el ORM.
- `alembic.ini` y `alembic/` (URL desde `DATABASE_URL`, autogenerate con todos los modelos, `render_as_batch` en SQLite).
- `conftest.py` en la raíz, para que lo vean `tests/` y `src/modules/*/tests/` (un `tests/conftest.py` no lo ven los tests de los módulos): `app`, `client` (TestClient con `app.dependency_overrides[get_db]` sobre SQLite en memoria) y `db`. `tests/test_health.py` prueba `/health` y CORS.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `pyproject.toml`, `uv.lock`, `src/core/**`, `src/main.py`, `src/__init__.py`, `alembic/**`, `conftest.py` (raíz y `tests/`), `__init__.py` de módulos |
| data-writer | `models.py`, `schemas.py` |
| logic-writer | `services.py`, `exceptions.py` |
| web-writer | `router.py`, `dependencies.py` |
| qa-writer | `src/modules/*/tests/test_*.py`, `tests/test_*.py`, `tests/**/test_*.py` |

Skills: `py-scaffold`, `py-verify` (la usa `make verify`), `py-patterns` (+ `references/auth.md`). Si usas Django, la tabla de equivalencias está en `py-patterns`.

## Docker

| Target | Uso |
|---|---|
| `dev` | `uv sync --frozen` (con dependencias dev) en `/opt/venv`, `uvicorn --reload` |
| `deps-prod` → `prod` | `uv sync --frozen --no-dev`; imagen limpia con el venv copiado, usuario `app` (1001), `read_only` + `tmpfs`, healthcheck con `urllib` |

- **El venv vive en `/opt/venv`**, fuera del bind mount: `make install` reconstruye la imagen.
- **`make new-app`** genera `uv.lock` con `ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim`.
- **`make deps-add PKGS="…" [DEV=1]`** ejecuta `uv add` dentro de Docker y reconstruye.
- **`migrate`** ejecuta `alembic upgrade head` con el target del entorno. Por eso **Alembic es una dependencia de runtime**, no de desarrollo.

## Auth: JWT (detalle en `py-patterns/references/auth.md`)

1. Dependencias (SQLAlchemy, Alembic y los drivers ya vienen): `make deps-add PKGS="pyjwt==<x.y.z> pwdlib[argon2]==<x.y.z>"`, versiones exactas con al menos 14 días.
2. `core/db.py` ya existe (`Base`, `get_db()`, `load_models()`); los fixtures `user` y `auth_as` van en el `conftest.py` de la raíz.
3. `core/security.py`:
   - argon2id con `pwdlib`.
   - `ALGORITHM = "HS256"` fijo.
   - Decodificación con `algorithms=[…]`, `audience`, `issuer` y `require` de `exp`, `sub`, `iss` y `aud`.
   - `CurrentUser`, `get_current_user` y `require_role`.
   - Un `DUMMY_HASH` para que el login tarde lo mismo exista o no el usuario.
4. Módulo `auth`:
   - Tablas `User` y `RefreshToken` (`token_hash`, `family_id`, `expires_at`, `revoked_at`).
   - `rotate()`: si se presenta un refresh ya rotado, revoca toda la familia.
   - Endpoints `/auth/register`, `/login`, `/refresh`, `/logout`, `/me`.
5. Si el cliente es un navegador, el refresh viaja en cookie `httponly` + `secure` + `samesite=lax`. El rate limit va en `slowapi` o en el proxy.
6. Variables: `JWT_SECRET=__GENERATE__`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES=15`, `REFRESH_TOKEN_DAYS=14`.

## Comandos

```bash
make dev
make test
make verify SCOPE=src/modules/<m>
make migration NAME=x        # autogenerate de Alembic
make migrate
make deps-add PKGS="…"
```

## Seguridad específica

- **Entrada y salida**: `extra="forbid"` en la entrada y `response_model` siempre en la salida.
- **SQL**: solo con ORM o `text(":param")`.
- **Autorización por recurso**: en services; un recurso ajeno responde 404.
- **Paginación**: `le=100`.
- **Funciones prohibidas**: `eval`, `pickle.loads` y `yaml.load` sobre datos de entrada, y `shell=True`.
- **CORS**: orígenes explícitos, nunca `*` con credenciales.

## Errores comunes

- Services que lanzan `HTTPException`.
- Un solo schema para entrada y salida.
- Dos agentes editando `main.py`.
- Alembic como dependencia de desarrollo: `make prod-migrate` falla.
- Instalar paquetes con `pip` en el host.
- Fixtures en `tests/conftest.py`: los tests de `src/modules/*/tests/` no los ven (van en el `conftest.py` de la raíz).
- Importar un modelo sin pasar por `load_models()`: una FK a la tabla de otro módulo falla con `NoReferencedTableError`.
