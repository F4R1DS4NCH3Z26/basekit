#!/usr/bin/env bash
# Cambia el esqueleto de basekit (SQLAlchemy + Alembic) a MongoDB con Beanie cuando el overlay que activó infra-setup es
# MongoDB (compose.db.yaml con DB_DRIVER: mongodb). Lo ejecuta `make new-app` antes de `uv lock`; con otra BD o sin BD no
# hace nada. Sin red. Idempotente: un archivo que ya tiene la variante Beanie se conserva.
# Para pasar a MongoDB después de make new-app: activa la BD con infra-setup, borra uv.lock y vuelve a ejecutar make new-app.
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f pyproject.toml ] || { echo "ERROR: ejecútalo en la raíz del proyecto FastAPI (falta pyproject.toml)"; exit 2; }

# Same source as nest-scaffold's app-setup.sh: the DB_DRIVER of the overlay infra-setup activated.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
[ "$driver" = mongodb ] || exit 0

# Alembic revisions are never deleted: a project that already has them chose SQL.
if [ -d alembic/versions ] && find alembic/versions -type f -name '*.py' | grep -q .; then
  echo "ERROR: alembic/versions tiene migraciones; no se borran. MongoDB no usa Alembic: quítalas tú si de verdad cambias de BD"
  exit 2
fi

# to_beanie <ruta> <marca>: escribe stdin en la ruta salvo que ya tenga la marca de la variante Beanie (atómico).
# chmod 644: mktemp creates 0600 files, and the starter's files are world-readable.
to_beanie() {
  if [ -f "$1" ] && grep -q "$2" "$1"; then cat >/dev/null; echo "  = $1"; return 0; fi
  mkdir -p "$(dirname "$1")"; local tmp; tmp=$(mktemp "$1.XXXXXX"); cat > "$tmp"; chmod 644 "$tmp"; mv "$tmp" "$1"; echo "  ~ $1"
}

to_beanie pyproject.toml '"beanie==' <<'TOML'
[project]
name = "app"
version = "0.1.0"
requires-python = ">=3.12"
# Exact versions (repo rule), each at least 14 days old. MongoDB with Beanie (an ODM over PyMongo's async API);
# `make migrate` creates the declared indexes (src/core/create_indexes.py). PyMongo is pinned too, so uv lock never
# picks a driver release younger than 14 days.
dependencies = [
    "fastapi[standard]==0.162.0",
    "pydantic-settings==2.16.1",
    "beanie==2.2.0",
    "pymongo==4.19.0",
]

[dependency-groups]
# pymongo-async-mock + mongomock: the in-memory MongoDB of the tests (conftest.py), with no network or real database.
dev = [
    "pytest==9.1.1",
    "ruff==0.17.2",
    "mypy==2.4.0",
    "httpx==0.28.1",
    "pymongo-async-mock==0.1.3",
    "mongomock==4.3.0",
]

[tool.ruff]
line-length = 100
target-version = "py312"
# Agent files and docs hold Markdown with sample code: ruff must not reformat them.
extend-exclude = [".agents", ".claude", ".opencode", ".hermes", "docs"]

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "S", "SIM"]   # S = reglas de seguridad (bandit)

[tool.ruff.lint.isort]
known-first-party = ["src"]

[tool.ruff.lint.per-file-ignores]
"**/tests/**" = ["S101"]
"tests/**" = ["S101"]

[tool.mypy]
strict = true
plugins = ["pydantic.mypy"]

[[tool.mypy.overrides]]
module = ["mongomock.*", "pymongo_async_mock.*"]
ignore_missing_imports = true

[tool.pytest.ini_options]
testpaths = ["src", "tests"]
TOML

to_beanie src/core/config.py 'mongo_url' <<'PY'
"""Configuración tipada desde variables de entorno (nunca leas .env a mano)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    app_env: str = "dev"
    cors_origins: str = "http://localhost:3000"
    # El overlay de BD (MongoDB) inyecta MONGO_URL con el usuario de la app; sin ella no arranca.
    mongo_url: str | None = None

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
PY

to_beanie src/core/db.py 'init_beanie' <<'PY'
"""MongoDB con Beanie: modelos de `src/modules/*/models.py`, conexión en el lifespan e índices."""

import importlib
import inspect
import pkgutil
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from pathlib import Path
from typing import Any

from beanie import Document, init_beanie
from fastapi import FastAPI
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from src.core.config import get_settings

MODULES_DIR = Path(__file__).resolve().parents[1] / "modules"


def document_models() -> list[type[Document]]:
    """Los `Document` de Beanie declarados en todos los `src/modules/*/models.py`.

    Beanie los necesita todos a la vez (un `Link` entre módulos solo resuelve así): la app, los
    tests (`conftest.py`) y `make migrate` (`create_indexes.py`) los cargan con esta función.
    """
    models: list[type[Document]] = []
    for info in sorted(pkgutil.iter_modules([str(MODULES_DIR)]), key=lambda i: i.name):
        if not (MODULES_DIR / info.name / "models.py").is_file():
            continue
        module = importlib.import_module(f"src.modules.{info.name}.models")
        for obj in vars(module).values():
            if (
                inspect.isclass(obj)
                and issubclass(obj, Document)
                and obj.__module__ == module.__name__
            ):
                models.append(obj)
    return models


def mongo_client() -> AsyncMongoClient[dict[str, Any]]:
    """Cliente de MONGO_URL. La base de datos es la de la URL: `client.get_default_database()`."""
    url = get_settings().mongo_url
    if not url:
        raise RuntimeError(
            "MONGO_URL no está definida (activa MongoDB con la skill infra-setup y make env)"
        )
    return AsyncMongoClient(url, uuidRepresentation="standard")


async def init_db(database: AsyncDatabase[Any], *, create_indexes: bool) -> list[type[Document]]:
    """Inicializa Beanie con todos los modelos.

    Con `create_indexes` crea los índices declarados (`Settings.indexes`, `Indexed`) que falten.
    Nunca borra uno: quitar un índice del modelo no lo quita de la BD (ver py-patterns).
    """
    models = document_models()
    await init_beanie(
        database=database,
        document_models=models,
        skip_indexes=not create_indexes,
        allow_index_dropping=False,
    )
    return models


def lifespan(
    database: AsyncDatabase[Any] | None = None,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Beanie listo antes de la primera petición: si MongoDB no responde, la app no arranca.

    Sin `database` se conecta con MONGO_URL. Índices: en dev se crean al arrancar; en prod no
    (construir un índice sobre una colección grande la carga): los crea `make migrate ENV=prod`.
    Los tests pasan una base de datos en memoria (`conftest.py`).
    """

    @asynccontextmanager
    async def run(_: FastAPI) -> AsyncIterator[None]:
        if database is not None:
            await init_db(database, create_indexes=True)
            yield
            return
        client = mongo_client()
        try:
            await init_db(
                client.get_default_database(), create_indexes=get_settings().app_env != "prod"
            )
            yield
        finally:
            await client.close()

    return run
PY

to_beanie src/core/create_indexes.py 'create_indexes OK' <<'PY'
"""`make migrate` con MongoDB: crea los índices que declaran los modelos y nunca borra ninguno.

MongoDB no tiene migraciones. Un índice que quitas de un modelo sigue en la BD hasta que lo borras a
mano: `make db-shell`, `db.<colección>.getIndexes()` y `db.<colección>.dropIndex('<nombre>')`.
"""

import asyncio

from src.core.db import init_db, mongo_client


async def main() -> None:
    client = mongo_client()
    try:
        models = await init_db(client.get_default_database(), create_indexes=True)
        for model in models:
            print(f"  {model.get_collection_name()}: índices declarados creados")
        if models:
            print(f"create_indexes OK: {len(models)} modelos")
        else:
            print("create_indexes: ningún modelo en src/modules/*/models.py")
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
PY

to_beanie src/main.py 'lifespan=lifespan' <<'PY'
"""Punto de entrada. Registra aquí los routers de cada módulo (zona del orquestador)."""

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo.asynchronous.database import AsyncDatabase

from src.core.config import get_settings
from src.core.db import lifespan


def create_app(database: AsyncDatabase[Any] | None = None) -> FastAPI:
    """`database` es solo para los tests (MongoDB en memoria, conftest.py); sin ella, MONGO_URL."""
    settings = get_settings()
    app = FastAPI(
        title="app",
        docs_url="/docs" if settings.app_env != "prod" else None,
        redoc_url=None,
        lifespan=lifespan(database),
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # from src.modules.<modulo>.router import router as <modulo>_router
    # app.include_router(<modulo>_router)
    return app


app = create_app()
PY

to_beanie conftest.py 'AsyncMongoMockClient' <<'PY'
"""Fixtures compartidas (zona del orquestador): `app`, `client` y `db` sobre MongoDB en memoria.

Vive en la raíz para que la vean los tests de `tests/` y los de `src/modules/*/tests/`.
MongoDB en memoria: mongomock detrás de la API async de PyMongo (pymongo-async-mock), sin red ni BD
real. Cada test recibe una base de datos vacía con Beanie inicializado; los tests async llevan
`@pytest.mark.anyio`. Cuando exista auth, agrega aquí `user` y `auth_as(user)`
(ver py-patterns/references/auth.md).
"""

import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mongomock.database import Database as MockDatabase
from pymongo.asynchronous.database import AsyncDatabase
from pymongo_async_mock import AsyncMongoMockClient

from src.core.db import init_db
from src.main import create_app

# Beanie 2 lists collections with authorizedCollections/nameOnly, which mongomock 4.3 rejects.
_list_collection_names = MockDatabase.list_collection_names


def _list_collection_names_compat(
    self: Any, filter: Any = None, session: Any = None, **_: Any
) -> list[str]:
    return _list_collection_names(self, filter=filter, session=session)  # type: ignore[no-untyped-call, no-any-return]


MockDatabase.list_collection_names = _list_collection_names_compat  # type: ignore[method-assign]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def db() -> AsyncDatabase[Any]:
    database: AsyncDatabase[Any] = AsyncMongoMockClient()["test"]
    asyncio.run(init_db(database, create_indexes=True))
    return database


@pytest.fixture
def app(db: AsyncDatabase[Any]) -> FastAPI:
    return create_app(database=db)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c
PY

for f in alembic.ini alembic; do
  if [ -e "$f" ]; then rm -rf "$f"; echo "  - $f"; fi
done
echo "mongo-setup OK: MongoDB (Beanie)"
