# Stack: Python · Django + Django REST Framework · v1

Plantillas: `plantillas/stacks/django/`. Tipo de app: **API REST + admin de Django**. Auth por defecto: **SimpleJWT** (access + refresh rotado con lista negra). Puerto: 8000. Healthcheck: `/health`. Admin: `/admin/` (ruta configurable con `ADMIN_URL`).

## Detección y esqueleto

- **Detección**: `detect.files = ["manage.py"]`. Sin `manifest`/`contains`: la detección es una búsqueda de subcadena sensible a mayúsculas y los stacks se prueban en orden de id, y `django` va antes que `fastapi`.
- **`appMarker`: `uv.lock`**. Si falta, el CLI copia `starter/` sin sobrescribir nada y avisa que falta `make new-app`, que solo genera `uv.lock` con uv dentro de Docker. Con `uv.lock` presente, `make new-app` no hace nada y no llama a Docker.
- **El esqueleto** (`starter/`):
  - `manage.py` y `pyproject.toml`: Django 5.2 LTS, DRF, `django-cors-headers`, WhiteNoise, gunicorn, `psycopg[binary]`, PyMySQL y `redis`. Herramientas: ruff (reglas `S` de seguridad y `DJ`), mypy strict con `django-stubs` y `djangorestframework-stubs`, y pytest-django. Todas con versión exacta (regla del repo): las que resuelve `uv lock` con `--exclude-newer` de hace 14 días (2026-10-26), p. ej. `django==5.2.18`, `djangorestframework==3.18.3`, `mypy==1.19.1` (django-stubs 5.2.x exige mypy < 1.20).
  - `src/config/settings.py`: todo sale de variables de entorno.
  - `src/config/settings_test.py`: SQLite en memoria para pytest, mypy y `make verify`.
  - `src/core/health.py`, `src/core/pagination.py` y `conftest.py` en la raíz (fixtures `api_client`, `user`, `other_user` y `auth_as`).
- **Proyectos que ya tienen `manage.py`**: se detectan, pero sin `uv.lock` el esqueleto agrega los archivos que falten (nunca sobrescribe). El Dockerfile usa uv, así que un proyecto con `requirements.txt` o Poetry tiene que pasar a `pyproject.toml` + `uv.lock`.

## Arquitectura (apps de Django por entidad)

```text
manage.py  pyproject.toml  uv.lock       # orquestador
src/
├── config/  settings.py  settings_test.py  urls.py  wsgi.py  asgi.py   # orquestador
├── core/    health.py  pagination.py                                   # orquestador
└── modules/<m>/                         # una app de Django (django-scaffold)
    ├── apps.py  migrations/             # orquestador
    ├── models.py  serializers.py  admin.py   # data-writer
    ├── exceptions.py  services.py       # logic-writer (sin HTTP)
    ├── views.py  urls.py  permissions.py     # web-writer
    └── tests/                           # qa-writer
conftest.py                              # fixtures en la raíz: los ven todos los tests (orquestador)
```

## Configuración (`src/config/settings.py`)

| Variable | Origen | Uso |
|---|---|---|
| `APP_ENV` | compose (`dev` o `prod`) | `DEBUG` solo con `dev`. Sin `APP_ENV` se comporta como prod. |
| `DJANGO_SECRET_KEY` | `.env` (`__GENERATE__`) | Obligatoria en prod. En dev o test, si falta, se usa una efímera. |
| `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `CORS_ORIGINS` | `.env` | Listas separadas por coma |
| `ADMIN_URL` | `.env` | Ruta del admin; cámbiala en prod |
| `DB_DRIVER` + `DB_*`, o `DATABASE_URL` | overlay de infra-setup | `postgres` → `django.db.backends.postgresql`; `mysql` → `django.db.backends.mysql` con PyMySQL; `sqlite` → `/app/data/app.db` |
| `REDIS_URL` | overlay de Redis | Caché `RedisCache`, que comparte el throttling de DRF entre workers. Sin Redis se usa `LocMemCache`. |

- **Sin overlay de BD**: SQLite en `data/app.db`, para que el admin funcione en dev. `data/` es del orquestador; no lo versiones.
- **MySQL con PyMySQL**, para no compilar `mysqlclient` en la imagen. Django 5.2 exige mysqlclient ≥ 2.2.1, así que `settings.py` declara esa versión antes de `install_as_MySQLdb()`. Si prefieres `mysqlclient`, agrega `gcc`, `pkg-config` y `default-libmysqlclient-dev` a las etapas de build y `libmariadb3` a la de prod.
- **DRF**:
  - Permiso por defecto: `IsAuthenticated`.
  - Paginación: `limit`/`offset`, con 100 como máximo.
  - Throttling: `anon` 60/min y `user` 600/min.
  - La API navegable solo existe con `DEBUG`.
- **Prod**: cookies `Secure`, `SECURE_PROXY_SSL_HEADER` (TLS en el proxy) y `SECURE_HSTS_SECONDS` desde el entorno.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `pyproject.toml`, `uv.lock`, `manage.py`, `src/config/**`, `src/core/**`, `src/__init__.py`, `src/modules/__init__.py`, `apps.py`, `migrations/**` y `__init__.py` de cada app, `conftest.py` (raíz), `data/**`, `staticfiles/**` |
| data-writer | `models.py`, `serializers.py`, `admin.py` |
| logic-writer | `services.py`, `exceptions.py` |
| web-writer | `views.py`, `urls.py`, `permissions.py` |
| qa-writer | `src/modules/*/tests/test_*.py`, `tests/test_*.py`, `tests/**/test_*.py` |

Skills: `django-scaffold`, `django-patterns` (+ `references/auth.md`) y `django-verify` (la usa `make verify`).

## Docker

| Target | Uso |
|---|---|
| `dev` | `uv sync --frozen` (con dependencias dev) en `/opt/venv`; `manage.py runserver 0.0.0.0:8000` con recarga |
| `deps-prod` → `prod` | `uv sync --frozen --no-dev`; `collectstatic` en el build (WhiteNoise sirve el admin); gunicorn con 2 workers; usuario `app` (1001), `read_only` + `tmpfs`, `cap_drop: [ALL]`; healthcheck con `urllib` |

- **El venv vive en `/opt/venv`**, fuera del bind mount: `make install` reconstruye la imagen.
- **`/health`** es un middleware que va primero: responde sin validar el host ni tocar la BD. Así el healthcheck sobre `127.0.0.1` funciona aunque `ALLOWED_HOSTS` solo tenga tu dominio.
- **`make new-app`** genera `uv.lock` con `ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim`.
- **`make deps-add PKGS="…" [DEV=1]`** ejecuta `uv add` dentro de Docker y reconstruye.
- **`migrate`** ejecuta `python manage.py migrate --noinput` con el target del entorno.
- **`make superuser`** crea un superusuario del admin.

## Auth: SimpleJWT (detalle en `django-patterns/references/auth.md`)

1. **Antes de la primera migración**: crea la app `accounts` con `User(AbstractUser)` (UUID, email único) y `AUTH_USER_MODEL = "accounts.User"`.
2. Instala la dependencia: `make deps-add PKGS="djangorestframework-simplejwt>=5.4"`.
3. Configura `SIMPLE_JWT`:
   - `HS256` fijo, con `audience` e `issuer`.
   - `SIGNING_KEY` = `JWT_SECRET`, de al menos 32 caracteres en prod.
   - Access de 15 min y refresh de 14 días.
   - `ROTATE_REFRESH_TOKENS` + `BLACKLIST_AFTER_ROTATION`, con la app `token_blacklist`.
4. Agrega `/api/auth/login/`, `/refresh/` y `/logout/` con `ScopedRateThrottle` (scope `auth`), además de `/register/` y `/me/` en `accounts`.
5. Si el cliente es un navegador, el refresh viaja en una cookie `httponly` + `secure` + `samesite=Lax`.
6. Variables: `JWT_SECRET=__GENERATE__`, `ACCESS_TOKEN_MINUTES=15`, `REFRESH_TOKEN_DAYS=14`.

## Comandos

```bash
make new-app                 # uv.lock (una vez)
make env && make dev && make migrate
make superuser
make test
make verify SCOPE=src/modules/<m>
make migration NAME=x        # makemigrations --name x
make deps-add PKGS="…"
```

## Seguridad específica

- **Serializers**: `fields` explícitos, nunca `"__all__"`. Los campos que decide el servidor van en `read_only_fields`.
- **Vistas**: `permission_classes` y `get_queryset` filtrado por el usuario. Un recurso ajeno responde 404.
- **SQL**: solo con el ORM o `cursor.execute(sql, [params])`. Nada de `raw()`/`extra()` con datos del usuario.
- **Prohibido**: `mark_safe` sobre datos del usuario, `csrf_exempt` en vistas con sesión, y `eval`, `pickle.loads` o `yaml.load` sobre la entrada.
- **CORS**: orígenes explícitos, nunca `*` con credenciales.
- **Admin**: cambia `ADMIN_URL` en prod. Solo entran cuentas `is_staff`.

## Errores comunes

- Migrar antes de definir `AUTH_USER_MODEL`.
- `fields = "__all__"` en un serializer.
- Services que importan `rest_framework` o reciben `request`.
- Dos agentes editando `settings.py` o `urls.py`: son del orquestador.
- Olvidar `make migration` tras cambiar un modelo (`django-verify` lo marca como FAIL).
- Instalar paquetes con `pip` en el host.
