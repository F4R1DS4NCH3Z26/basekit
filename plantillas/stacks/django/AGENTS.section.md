## Stack: Python · Django + Django REST Framework
- Dependencias con `uv` dentro de Docker (`pyproject.toml` + `uv.lock`). Datos: Django ORM y migraciones de Django sobre `DB_*`/`DATABASE_URL`. API: DRF. Auth: SimpleJWT (`django-patterns/references/auth.md`). Tests: pytest-django.
- `src/config/`: `settings.py` (todo desde variables de entorno), `settings_test.py`, `urls.py`, `wsgi.py`. `src/core/`: `/health`, paginación.
- `src/modules/<m>/` es una app de Django: `models.py` · `serializers.py` · `admin.py` · `exceptions.py` · `services.py` (sin HTTP) · `views.py` · `urls.py` · `permissions.py` · `migrations/` · `tests/`.
- Serializers con `fields` explícitos (nunca `"__all__"`) y campos del servidor en `read_only_fields`. Vistas con `permission_classes` y `get_queryset` filtrado por usuario. SQL solo con ORM o parámetros.

| Rol | Zona |
|---|---|
| orquestador | lo común + `pyproject.toml`, `uv.lock`, `manage.py`, `src/config/`, `src/core/`, `apps.py` y `migrations/` de cada app, `conftest.py` |
| data-writer | `models.py`, `serializers.py`, `admin.py` |
| logic-writer | `services.py`, `exceptions.py` |
| web-writer | `views.py`, `urls.py`, `permissions.py` |
| qa-writer | `src/modules/*/tests/test_*.py` |

Comandos: `make new-app` (genera `uv.lock`) · `make dev` (puerto 8000, admin en `/admin/`) · `make test` · `make verify SCOPE=src/modules/<m>` · `make migration NAME=x` (`makemigrations`) · `make migrate` · `make sh` → `python manage.py createsuperuser`
