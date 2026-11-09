## Stack: Python · Flask (API REST ligera)
- Dependencias con `uv` dentro de Docker (`pyproject.toml` + `uv.lock`). Datos: SQLAlchemy 2 + Alembic sobre `DATABASE_URL`. Validación: Pydantic v2. Auth: JWT propio (`src/core/security.py`). Tests: pytest + test client de Flask.
- `src/core/`: `config.py` (pydantic-settings), `db.py` (`Base`, `get_db()`: una sesión por petición), `security.py`. `src/main.py`: `create_app()`, errores en JSON, CORS y registro de Blueprints.
- `src/modules/<m>/`: `models.py` · `schemas.py` · `exceptions.py` · `services.py` (sin Flask) · `routes.py` (Blueprint `bp`) · `tests/`.
- Entrada validada con schemas `extra="forbid"`; salida siempre por el schema de lectura, nunca el modelo ORM. SQL solo con ORM o parámetros enlazados.

| Rol | Zona |
|---|---|
| orquestador | lo común + `pyproject.toml`, `uv.lock`, `src/core/`, `src/main.py`, `alembic/`, `alembic.ini`, `conftest.py` |
| data-writer | `models.py`, `schemas.py` |
| logic-writer | `services.py`, `exceptions.py` |
| web-writer | `routes.py` |
| qa-writer | `src/modules/*/tests/test_*.py`, `tests/test_*.py` |

Comandos: `make dev` (puerto 8000, `/health`) · `make test` · `make verify SCOPE=src/modules/<m>` · `make migration NAME=x` (Alembic) · `make migrate`
