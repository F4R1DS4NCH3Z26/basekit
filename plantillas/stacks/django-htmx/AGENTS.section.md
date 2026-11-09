## Stack: Python · Django + HTMX (fullstack, plantillas del servidor)
- Dependencias con `uv` dentro de Docker (`pyproject.toml` + `uv.lock`). Sin SPA, sin Node y sin build de JS: HTMX 2.0.11 está fijado en `static/vendor/` (con SRI en `templates/base.html`) y lo sirve staticfiles (WhiteNoise en prod). `request.htmx` lo da django-htmx. Datos: Django ORM y migraciones sobre `DB_*`/`DATABASE_URL`. Auth: sesión de Django con login/logout (`djhtmx-patterns/references/auth.md`). Tests: pytest-django.
- `src/config/`: settings (todo desde variables de entorno), urls (portada, login, logout, admin). `src/core/`: `/health`, CSP, `htmx.py` (`render_page`, `AuthedHtmxRequest`), paginación. `templates/`: `base.html` (htmx-config y CSRF en `hx-headers`), `registration/login.html`.
- `src/modules/<m>/` es una app de Django: `models.py` · `admin.py` · `exceptions.py` · `services.py` (sin HTTP) · `forms.py` · `views.py` · `urls.py` · `templates/<m>/` (`<x>.html` completas, `_<x>.html` parciales) · `migrations/` · `tests/`.
- Cada vista responde la página completa o, con `request.htmx`, solo el parcial. Validación inválida → el parcial con errores y 422. Formularios con campos explícitos; las escrituras van por `services.py`. Plantillas con autoescape: nunca `|safe` sobre datos del usuario, ni scripts o estilos en línea (CSP `'self'` en prod).

| Rol | Zona |
|---|---|
| orquestador | lo común + `pyproject.toml`, `uv.lock`, `manage.py`, `src/config/`, `src/core/`, `static/vendor/`, `apps.py` y `migrations/` de cada app, `conftest.py` |
| data-writer | `models.py`, `admin.py` |
| logic-writer | `services.py`, `exceptions.py` |
| views-writer | `views.py`, `urls.py`, `forms.py`, `templates/**` (proyecto y app), `static/css/`, `static/img/`, `static/js/` |
| qa-writer | `src/modules/*/tests/test_*.py`, `tests/test_*.py` |

Comandos: `make new-app` (genera `uv.lock`) · `make dev` (puerto 8000, admin en `/admin/`) · `make test` · `make verify SCOPE=src/modules/<m>` · `make migration NAME=x` (`makemigrations`) · `make migrate` · `make superuser`
