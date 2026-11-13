## Stack: Python · Flask (API REST ligera)
- Dependencias con `uv` dentro de Docker (`pyproject.toml` + `uv.lock`). Datos: SQLAlchemy 2 + Alembic sobre `DATABASE_URL` o, con MongoDB, PyMongo sobre `MONGO_URL` (sin Alembic). Validación: Pydantic v2. Auth: JWT propio (`src/core/security.py`). Tests: pytest + test client de Flask.
- `src/core/`: `config.py` (pydantic-settings), `db.py` (`Base`, `get_db()`: una sesión por petición; con MongoDB `get_db()` da la base de datos, `create_indexes` y `create_indexes.py`), `security.py`. `src/main.py`: `create_app()`, errores en JSON, CORS y registro de Blueprints.
- `src/modules/<m>/`: `models.py` (SQLAlchemy, o con MongoDB `COLLECTION`, `INDEXES` y un `TypedDict`) · `schemas.py` · `exceptions.py` · `services.py` (sin Flask) · `routes.py` (Blueprint `bp`) · `tests/`.
- Entrada validada con schemas `extra="forbid"`; salida siempre por el schema de lectura, nunca el modelo ORM ni el documento. SQL solo con ORM o parámetros enlazados; MongoDB, filtros armados en services, nunca un dict del cliente.

| Rol | Zona |
|---|---|
| orquestador | lo común + `pyproject.toml`, `uv.lock`, `src/core/`, `src/main.py`, `alembic/`, `alembic.ini`, `conftest.py` |
| data-writer | `models.py`, `schemas.py` |
| logic-writer | `services.py`, `exceptions.py` |
| web-writer | `routes.py` |
| qa-writer | `src/modules/*/tests/test_*.py`, `tests/test_*.py` |

Comandos: `make dev` (puerto 8000, `/health`) · `make test` · `make verify SCOPE=src/modules/<m>` · `make migration NAME=x` (Alembic; con MongoDB no hay migraciones) · `make migrate` (Alembic: migraciones; MongoDB: crea los índices declarados, nunca los borra)
