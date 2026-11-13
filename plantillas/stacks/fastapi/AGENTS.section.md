## Stack: Python · FastAPI
- Dependencias con `uv` dentro de Docker (`pyproject.toml` + `uv.lock`). Datos: SQLAlchemy 2 + Alembic sobre `DATABASE_URL` o, con MongoDB, Beanie sobre `MONGO_URL` (sin Alembic). Auth: JWT propio (`src/core/security.py`). Tests: pytest.
- `src/core/`: `config.py` (pydantic-settings), `db.py` (`Base`, `get_db`, `load_models`; con MongoDB `init_db`, `lifespan` y `create_indexes.py`), `security.py`. `src/main.py`: `create_app()` y registro de routers. `conftest.py` (raíz): fixtures `app`, `client`, `db`.
- `src/modules/<m>/`: `models.py` (SQLAlchemy, o `Document` de Beanie con MongoDB) · `schemas.py` · `exceptions.py` · `services.py` (sin HTTP) · `router.py` · `tests/`.
- Schemas de entrada con `extra="forbid"`; salida siempre por `response_model`. SQL solo con ORM o parámetros enlazados.

| Rol | Zona |
|---|---|
| orquestador | lo común + `pyproject.toml`, `uv.lock`, `src/core/`, `src/main.py`, `alembic/`, `conftest.py` |
| data-writer | `models.py`, `schemas.py` |
| logic-writer | `services.py`, `exceptions.py` |
| web-writer | `router.py`, `dependencies.py` |
| qa-writer | `src/modules/*/tests/test_*.py`, `tests/test_*.py` |

Comandos: `make dev` (puerto 8000, docs en `/docs`) · `make test` · `make verify SCOPE=src/modules/<m>` · `make migration NAME=x` (Alembic; con MongoDB no hay migraciones) · `make migrate` (Alembic: migraciones; MongoDB: crea los índices de los modelos, nunca los borra)
