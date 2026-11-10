# Stack: Python · Django + HTMX (fullstack, plantillas del servidor) · v1

Plantillas: `plantillas/stacks/django-htmx/`. Tipo de app: **fullstack integrado** (`kind: "fullstack"`): Django 5.2 LTS renderiza HTML en el servidor y HTMX hace las actualizaciones parciales. Sin SPA, sin Node, sin paso de build de JS y sin DRF. Auth por defecto: **sesión de Django** (login y logout con CSRF). Puerto: 8000. Healthcheck: `/health`. Admin: `/admin/` (ruta configurable con `ADMIN_URL`).

## Detección y esqueleto

- **Detección**: `detect: {}`. Nunca se autodetecta: un proyecto con `manage.py` lo toma `django`, y estrechar `django` cambiaría proyectos que ya existen (S7). Se elige con la pregunta de `init` (Tipo → Lenguaje → Template) o con `--stack django-htmx`.
- **`appMarker`: `uv.lock`**. Si falta, el CLI copia `starter/` sin sobrescribir nada y avisa que falta `make new-app`, que solo genera `uv.lock` con uv dentro de Docker. Con `uv.lock` presente, `make new-app` no hace nada y no llama a Docker.
- **El esqueleto** (`starter/`):
  - `manage.py` y `pyproject.toml` con versiones exactas (≥ 14 días): `django==5.2.18`, `django-htmx==1.29.0` (`request.htmx`), `whitenoise==6.12.0`, `gunicorn==26.2.0`, `psycopg[binary]==3.3.6`, `pymysql==1.2.3`, `redis==8.1.0`, `django-stubs-ext==5.2.9`. Herramientas: ruff (reglas `S` de seguridad y `DJ`), mypy strict con `django-stubs[compatible-mypy]==5.2.9` (exige `mypy<1.20`, por eso `mypy==1.19.1`) y `pytest-django==4.14.0`.
  - `src/config/settings.py`: todo sale de variables de entorno. `settings_test.py`: SQLite en memoria.
  - `src/core/`: `health.py` (middleware `/health`), `security.py` (CSP), `htmx.py` (`render_page`, `wants_partial`, `HtmxRequest`/`AuthedHtmxRequest`, `HtmxLoginRedirectMiddleware`), `pagination.py` (`paginate`) y `views.py` (portada).
  - `templates/`: `base.html`, `home.html`, `registration/login.html`. `static/`: `vendor/htmx-2.0.11.min.js` (+ licencia 0BSD) y `css/app.css`.
  - `conftest.py` en la raíz: fixtures `user`, `other_user`, `login_as` y `csrf_client` (pytest-django ya da `client`).

## HTMX fijado (sin Node)

| Dato | Valor |
|---|---|
| Versión | `htmx.org` 2.0.11 (22 de septiembre de 2026; `latest` de npm). htmx 4 existe, pero cambia la API: se adopta aparte. |
| Archivo | `static/vendor/htmx-2.0.11.min.js`, copia exacta de `dist/htmx.min.js` del tarball de npm (integridad del tarball `sha512-Thx/WtpeOQqSrqBCw/A1cwGJGg4UrVa3+sW0GmrM3p4gJgO89ecH4qtbnyzDDWFvBTqjnIMCgELTNt636dtamA==`) |
| SRI | `sha384-2OatzQy1H+Zd/IIrjr1TcuDGqLXeHhbooAyJY1KdQMKnr4LZ22k31GBLdYKHmVjg`, en el `integrity` de `templates/base.html` |
| Servido por | staticfiles: `runserver` en dev; en prod `collectstatic` en el build y WhiteNoise con nombres con hash (el contenido no cambia, así que el SRI sigue valiendo) |

Para actualizar: descarga el tarball de la versión nueva (≥ 14 días), comprueba su `integrity` contra el registro de npm, copia `dist/htmx.min.js` con la versión en el nombre, recalcula el SRI (`openssl dgst -sha384 -binary <archivo> | base64`) y cambia `base.html`. `static/vendor/` es del orquestador.

`base.html` fija `htmx-config`: `selfRequestsOnly`, `allowEval: false`, `allowScriptTags: false`, `includeIndicatorStyles: false` (los estilos del indicador están en `app.css`), `historyCacheSize: 0` (no copia páginas privadas a `localStorage`) y `responseHandling` con 422 intercambiable (errores de validación). `<body>` lleva `hx-headers='{"X-CSRFToken": "{{ csrf_token }}"}'`.

## Arquitectura (apps de Django por entidad)

```text
manage.py  pyproject.toml  uv.lock  conftest.py          # orquestador
src/
├── config/  settings.py  settings_test.py  urls.py  wsgi.py  asgi.py     # orquestador
├── core/    health.py  security.py  htmx.py  pagination.py  views.py    # orquestador
└── modules/<m>/                         # una app de Django (djhtmx-scaffold)
    ├── apps.py  migrations/             # orquestador
    ├── models.py  admin.py              # data-writer
    ├── exceptions.py  services.py       # logic-writer (sin HTTP ni formularios)
    ├── forms.py  views.py  urls.py      # views-writer
    ├── templates/<m>/  <x>.html (páginas)  _<x>.html (parciales HTMX)   # views-writer
    └── tests/                           # qa-writer
templates/  base.html  home.html  registration/login.html                # views-writer
static/     vendor/ (orquestador: htmx fijado)  css/  img/  js/ (views-writer)
```

Cada vista responde con `render_page(request, página, parcial, contexto, status)`: la página completa (extiende `base.html`) en una petición normal y solo el parcial con `HX-Request: true` (salvo un *history restore*), con `Vary: HX-Request`. Validación inválida → el mismo parcial con los errores y status 422. Las escrituras pasan por `services.py`; la vista nunca llama a `form.save()`. El CRUD de referencia (lista paginada con `hx-get`, alta y edición en línea, borrado, swaps out-of-band) está en `djhtmx-patterns`.

## Configuración (`src/config/settings.py`)

| Variable | Origen | Uso |
|---|---|---|
| `APP_ENV` | compose (`dev` o `prod`) | `DEBUG` solo con `dev`. Sin `APP_ENV` se comporta como prod. |
| `DJANGO_SECRET_KEY` | `.env` (`__GENERATE__`) | Obligatoria en prod (`ImproperlyConfigured` si falta). En dev o test, si falta, se usa una efímera. |
| `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` | `.env` | Listas separadas por coma |
| `ADMIN_URL` | `.env` | Ruta del admin; cámbiala en prod |
| `SESSION_COOKIE_AGE` | `.env` | Duración de la sesión de login (14 días por defecto) |
| `DB_DRIVER` + `DB_*`, o `DATABASE_URL` | overlay de infra-setup | `postgres` → `django.db.backends.postgresql`; `mysql` → `django.db.backends.mysql` con PyMySQL; `sqlite` → `/app/data/app.db` |
| `REDIS_URL` | overlay de Redis | Caché `RedisCache` compartida entre workers. Sin Redis se usa `LocMemCache`. |

- **Sin overlay de BD**: SQLite en `data/app.db`, para que la app y el admin funcionen en dev. `data/` es del orquestador; no lo versiones.
- **MySQL con PyMySQL**, igual que `django`: `settings.py` declara la versión 2.2.1 de mysqlclient antes de `install_as_MySQLdb()`.
- **Middleware**: `/health` primero; luego `SecurityMiddleware`, la CSP, WhiteNoise (solo prod), sesión, CSRF, auth, `django_htmx.middleware.HtmxMiddleware` y `HtmxLoginRedirectMiddleware` (una petición HTMX sin sesión recibe `HX-Redirect` al login).
- **Plantillas**: `DIRS = [templates/]` + `APP_DIRS`; `autoescape` activo (explícito).
- **Prod**: CSP `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`; cookies `Secure`; `SECURE_PROXY_SSL_HEADER` (TLS en el proxy) y `SECURE_HSTS_SECONDS` desde el entorno. En dev no hay CSP (la página de error de Django usa estilos en línea).

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `pyproject.toml`, `uv.lock`, `manage.py`, `src/config/**`, `src/core/**`, `src/__init__.py`, `src/modules/__init__.py`, `apps.py`, `migrations/**` y `__init__.py` de cada app, `conftest.py` (raíz), `static/vendor/**`, `data/**`, `staticfiles/**` |
| data-writer | `models.py`, `admin.py` |
| logic-writer | `services.py`, `exceptions.py` |
| views-writer | `views.py`, `urls.py`, `forms.py`, `src/modules/*/templates/**`, `src/modules/*/static/**`, `templates/**`, `static/css/**`, `static/img/**`, `static/js/**` |
| qa-writer | `src/modules/*/tests/test_*.py`, `tests/test_*.py`, `tests/**/test_*.py` |

Los formularios son del views-writer (son la validación de la entrada web, como los serializers en `django`); el data-writer no los toca. Skills: `djhtmx-scaffold`, `djhtmx-patterns` (+ `references/auth.md`) y `djhtmx-verify` (la usa `make verify`).

## Docker

| Target | Uso |
|---|---|
| `dev` | `uv sync --frozen` (con dependencias dev) en `/opt/venv`; `manage.py runserver 0.0.0.0:8000` con recarga |
| `deps-prod` → `prod` | `uv sync --frozen --no-dev`; `collectstatic` en el build (WhiteNoise sirve htmx, `app.css` y el admin); gunicorn con 2 workers, `--worker-tmp-dir /tmp` y `--no-control-socket` (gunicorn 25+ en imagen `read_only`); usuario `app` (1001), `read_only` + `tmpfs`, `cap_drop: [ALL]`; healthcheck con `urllib` |

- **El venv vive en `/opt/venv`**, fuera del bind mount: `make install` reconstruye la imagen.
- **`/health`** es un middleware que va primero: responde sin validar el host ni tocar la BD.
- **`make new-app`** genera `uv.lock` con `ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim`.
- **`make deps-add PKGS="paquete==x.y.z" [DEV=1]`** ejecuta `uv add` dentro de Docker y reconstruye.
- **`migrate`** ejecuta `python manage.py migrate --noinput` con el target del entorno.
- **`make superuser`** crea un superusuario (sirve para el admin y para el login de la app).

## Auth: sesión de Django (detalle en `djhtmx-patterns/references/auth.md`)

1. Ya incluido: `LoginView` en `/login/` y `LogoutView` (solo POST) en `/logout/`, `templates/registration/login.html`, botón "Salir" con CSRF en `base.html`, cookies `HttpOnly` + `SameSite=Lax` (+ `Secure` en prod).
2. **Antes de la primera migración**, si hace falta usuario propio: app `accounts` con `User(AbstractUser)` (UUID, email único) y `AUTH_USER_MODEL = "accounts.User"`.
3. Registro de cuentas (si el contrato lo pide): `SignupForm` con `validate_password`, `services.register`, `login(request, user)` tras crear.
4. Antes de prod: límite de intentos de login con `django-axes` (versión exacta con ≥ 14 días).

## Comandos

```bash
make new-app                 # uv.lock (una vez)
make env && make dev && make migrate
make superuser
make test
make verify SCOPE=src/modules/<m>
make migration NAME=x        # makemigrations --name x
make deps-add PKGS="paquete==x.y.z"
```

## Seguridad específica

- **Plantillas**: autoescape siempre. Prohibido `|safe`, `|safeseq` y `{% autoescape off %}` (`djhtmx-verify` falla) y `mark_safe` sobre datos del usuario (ruff `S308`).
- **CSP**: nada de `<script>` en línea, `style=`, `onclick` ni `hx-on`; htmx corre sin eval. JS propio, si hace falta, como archivo en `static/js/`.
- **CSRF**: `{% csrf_token %}` en cada formulario y `hx-headers` en `<body>`. Nunca `csrf_exempt`.
- **Formularios**: campos explícitos; nunca `fields = "__all__"` ni `exclude`. El dueño sale de la sesión, nunca del formulario.
- **Vistas**: `@login_required`, métodos explícitos (`@require_GET`, `@require_POST`) y recurso ajeno → 404.
- **SQL**: solo con el ORM o `cursor.execute(sql, [params])`.
- **Admin**: cambia `ADMIN_URL` en prod. Solo entran cuentas `is_staff`.

## Verificación (`djhtmx-verify`)

ruff (check + format), mypy strict, "plantillas sin `|safe`", `manage.py check`, "migraciones al día", "plantillas compilan" (cada `.html` del alcance, y `templates/` con `SCOPE=src`) y pytest. Sin red ni BD real.

## Errores comunes

- Devolver la página completa a una petición HTMX (htmx la pega dentro del objetivo): usa `render_page`.
- Responder 400 con errores de validación: htmx no lo intercambia; usa 422.
- Un `<tr>` suelto en un swap out-of-band: el HTML lo descarta; usa `<div>`/`<article>` o envuélvelo en `<template>`.
- Olvidar `Vary: HX-Request` en una respuesta propia (un caché mezclaría página y fragmento).
- Editar `static/vendor/` a mano o cargar htmx desde un CDN (rompe el SRI y la CSP).
- Migrar antes de definir `AUTH_USER_MODEL`.
- Instalar paquetes con `pip` en el host.
