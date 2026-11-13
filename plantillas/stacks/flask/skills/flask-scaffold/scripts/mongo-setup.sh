#!/usr/bin/env bash
# Cambia el esqueleto de basekit (SQLAlchemy + Alembic) a MongoDB con PyMongo cuando el overlay que activó infra-setup es
# MongoDB (compose.db.yaml con DB_DRIVER: mongodb). Lo ejecuta `make new-app` antes de `uv lock`; con otra BD o sin BD no
# hace nada. Sin red. Idempotente: un archivo que ya tiene la variante PyMongo se conserva.
# Nunca sobrescribe un archivo que cambiaste: solo reemplaza los del esqueleto intactos. Si alguno cambió, se detiene
# sin tocar nada y dice cuáles.
# Para pasar a MongoDB después de make new-app: activa la BD con infra-setup, borra uv.lock y vuelve a ejecutar make new-app.
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f pyproject.toml ] || { echo "ERROR: ejecútalo en la raíz del proyecto Flask (falta pyproject.toml)"; exit 2; }

# One MongoDB detection, the same exact match as stack.mk and scaffold.sh.
grep -Eqs '^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$' compose.db.yaml || exit 0

# Alembic revisions are never deleted: a project that already has them chose SQL. find -quit, not `find | grep -q`:
# under pipefail grep's early exit can fail the pipeline.
if [ -d alembic/versions ] && [ -n "$(find alembic/versions -type f -name '*.py' -print -quit)" ]; then
  echo "ERROR: alembic/versions tiene migraciones; no se borran. MongoDB no usa Alembic: quítalas tú si de verdad cambias de BD"
  exit 2
fi

# cksum (POSIX: the same value on Linux, macOS and busybox) of each starter file this script replaces or removes.
starter_sum() {
  case "$1" in
    pyproject.toml) echo "1559675780 1206" ;;
    src/core/config.py) echo "3730237129 1246" ;;
    src/core/db.py) echo "2613215170 2229" ;;
    src/main.py) echo "1821796315 2401" ;;
    conftest.py) echo "2533436273 1350" ;;
    alembic.ini) echo "187729484 723" ;;
    alembic/env.py) echo "1279185857 1595" ;;
    alembic/script.py.mako) echo "3038668147 637" ;;
    alembic/versions/.gitkeep) echo "2831135567 53" ;;
    *) echo "" ;;
  esac
}
# A line only the PyMongo variant of each replaced file has.
mongo_mark() {
  case "$1" in
    pyproject.toml) echo '"pymongo==' ;;
    src/core/config.py) echo 'mongo_url' ;;
    src/core/db.py) echo 'def default_database' ;;
    src/core/create_indexes.py) echo 'create_indexes OK' ;;
    src/main.py) echo 'db.init_app(app, database)' ;;
    conftest.py) echo 'mongomock.MongoClient' ;;
  esac
}
replaced="pyproject.toml src/core/config.py src/core/db.py src/core/create_indexes.py src/main.py conftest.py"
is_starter() { [ "$(cksum < "$1")" = "$(starter_sum "$1")" ]; }

# Check everything first: either every file is replaceable, or nothing changes.
changed=()
for f in $replaced; do
  [ -f "$f" ] || continue
  grep -qF "$(mongo_mark "$f")" "$f" || is_starter "$f" || changed+=("$f")
done
if [ -f alembic.ini ] && ! is_starter alembic.ini; then changed+=(alembic.ini); fi
# alembic/ is removed whole, so anything in it that the starter does not have (or changed) stops the script.
if [ -d alembic ]; then
  while IFS= read -r f; do
    [ -f "$f" ] && is_starter "$f" || changed+=("$f")
  done < <(find alembic ! -type d | LC_ALL=C sort)
fi
if [ ${#changed[@]} -gt 0 ]; then
  echo "ERROR: estos archivos ya no son los del esqueleto de basekit y no se sobrescriben:"
  printf '  %s\n' "${changed[@]}"
  echo "Pasa tus cambios a la variante PyMongo a mano (ver flask-patterns) o restaura esos archivos y vuelve a ejecutar make new-app"
  exit 2
fi

# to_mongo <ruta>: writes stdin to the path unless it already holds the PyMongo variant (atomic).
# chmod 644: mktemp creates 0600 files, and the starter's files are world-readable.
to_mongo() {
  if [ -f "$1" ] && grep -qF "$(mongo_mark "$1")" "$1"; then cat >/dev/null; echo "  = $1"; return 0; fi
  mkdir -p "$(dirname "$1")"; local tmp; tmp=$(mktemp "$1.XXXXXX"); cat > "$tmp"; chmod 644 "$tmp"; mv "$tmp" "$1"; echo "  ~ $1"
}

# pyproject.toml is derived from the starter's (checked above), so its versions and tool settings live in one place:
# PyMongo takes SQLAlchemy's line, and Alembic, the SQL drivers and their tool settings go.
if [ -f pyproject.toml ] && ! grep -qF "$(mongo_mark pyproject.toml)" pyproject.toml; then
  awk '
    /^# Alembic and the drivers are runtime dependencies/ {
      print "# MongoDB with PyMongo: `make migrate` creates the declared indexes (src/core/create_indexes.py)."; next }
    /^    "sqlalchemy==/ { print "    \"pymongo==4.19.0\","; next }
    /^    "(alembic|psycopg\[binary\]|pymysql\[rsa\])==/ { next }
    /^dev = \[/ {
      print "# mongomock: the in-memory MongoDB of the tests (conftest.py), with no network or real database."
      sub(/\]$/, ", \"mongomock==4.3.0\"]"); print; next }
    /^extend-exclude = / { sub(/"alembic\/versions", /, ""); print; next }
    /^# The local alembic\/ folder/ || /^known-third-party = \["alembic"\]$/ || /^exclude = \["alembic\/versions\/"\]$/ { next }
    /^\[tool\.pytest\.ini_options\]$/ {
      print "[[tool.mypy.overrides]]"; print "module = [\"mongomock.*\"]"; print "ignore_missing_imports = true"; print "" }
    { print }
  ' pyproject.toml | to_mongo pyproject.toml
else
  to_mongo pyproject.toml </dev/null
fi

to_mongo src/core/config.py <<'PY'
"""Configuración tipada desde variables de entorno (nunca leas .env a mano)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    app_env: str = "dev"
    secret_key: str = ""
    cors_origins: str = "http://localhost:3000"
    # El overlay de MongoDB inyecta MONGO_URL con el usuario de la app; src/core/db.py la exige.
    mongo_url: str | None = None
    redis_url: str | None = None

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
PY

to_mongo src/core/db.py <<'PY'
"""MongoDB con PyMongo: un cliente por proceso, la base de datos de MONGO_URL e índices declarados.

Cada `src/modules/<m>/models.py` declara su colección (`COLLECTION`) y sus índices (`INDEXES`).
"""

import importlib
import pkgutil
from functools import lru_cache
from pathlib import Path
from typing import Any

from flask import Flask, current_app
from pymongo import IndexModel, MongoClient
from pymongo.database import Database

from src.core.config import get_settings

DATABASE_KEY = "mongo_database"
MODULES_DIR = Path(__file__).resolve().parents[1] / "modules"


def declared_indexes() -> list[tuple[str, list[IndexModel]]]:
    """(colección, índices) de cada `src/modules/*/models.py` que declara `COLLECTION`."""
    declared: list[tuple[str, list[IndexModel]]] = []
    for info in sorted(pkgutil.iter_modules([str(MODULES_DIR)]), key=lambda i: i.name):
        if not (MODULES_DIR / info.name / "models.py").is_file():
            continue
        module = importlib.import_module(f"src.modules.{info.name}.models")
        collection = getattr(module, "COLLECTION", None)
        if isinstance(collection, str):
            declared.append((collection, list(getattr(module, "INDEXES", []))))
    return declared


def create_indexes(database: Database[Any]) -> list[tuple[str, list[str]]]:
    """Crea los índices declarados que falten y devuelve, por colección, sus nombres.

    Nunca borra uno: quitar un índice de `INDEXES` no lo quita de la BD (ver flask-patterns).
    """
    done: list[tuple[str, list[str]]] = []
    for collection, indexes in declared_indexes():
        done.append((collection, database[collection].create_indexes(indexes) if indexes else []))
    return done


def mongo_client() -> MongoClient[dict[str, Any]]:
    """Cliente de MONGO_URL; `tz_aware`: las fechas vuelven con zona horaria."""
    url = get_settings().mongo_url
    if not url:
        raise RuntimeError(
            "MONGO_URL no está definida (activa MongoDB con la skill infra-setup y make env)"
        )
    return MongoClient(url, tz_aware=True)


@lru_cache
def default_database() -> Database[dict[str, Any]]:
    """La base de datos de MONGO_URL, creada en el primer uso (no al importar).

    En dev crea aquí los índices declarados que falten; en prod no (construir un índice sobre una
    colección grande la carga): los crea `make migrate ENV=prod`.
    """
    client = mongo_client()
    database = client.get_default_database()
    try:
        if get_settings().app_env != "prod":
            create_indexes(database)
    except Exception:
        client.close()
        raise
    return database


def get_db() -> Database[Any]:
    """Base de datos de la app: la de los tests (en memoria) o la de MONGO_URL."""
    database: Database[Any] | None = current_app.extensions[DATABASE_KEY]
    return database if database is not None else default_database()


def init_app(app: Flask, database: Database[Any] | None = None) -> None:
    """Los tests pasan `database` (MongoDB en memoria, conftest.py); si no, sale de MONGO_URL."""
    app.extensions[DATABASE_KEY] = database
PY

to_mongo src/core/create_indexes.py <<'PY'
"""`make migrate` con MongoDB: crea los índices que declaran los módulos y nunca borra ninguno.

MongoDB no tiene migraciones. Un índice que quitas de `INDEXES` sigue en la BD hasta que lo
borras a mano: `make db-shell`, `db.<colección>.getIndexes()` y `db.<colección>.dropIndex('<n>')`.
"""

from src.core.db import create_indexes, mongo_client


def main() -> None:
    client = mongo_client()
    try:
        client.admin.command("ping")  # falla aquí, con un error claro, si MongoDB no responde
        done = create_indexes(client.get_default_database())
        for collection, names in done:
            print(f"  {collection}: {len(names)} índices declarados")
        if done:
            print(f"create_indexes OK: {len(done)} colecciones")
        else:
            print("create_indexes: ninguna colección declarada en src/modules/*/models.py")
    finally:
        client.close()


if __name__ == "__main__":
    main()
PY

to_mongo src/main.py <<'PY'
"""Punto de entrada. Registra aquí los blueprints de cada módulo (zona del orquestador)."""

from typing import Any

from flask import Flask, Response, jsonify, request
from pydantic import ValidationError
from pymongo.database import Database
from werkzeug.exceptions import HTTPException

from src.core import db
from src.core.config import get_settings

MAX_BODY_BYTES = 1024 * 1024


def create_app(database: Database[Any] | None = None) -> Flask:
    """`database` es solo para los tests (MongoDB en memoria, conftest.py); sin ella, MONGO_URL."""
    settings = get_settings()
    app = Flask(__name__)
    app.config.update(SECRET_KEY=settings.secret_key, MAX_CONTENT_LENGTH=MAX_BODY_BYTES)
    db.init_app(app, database)
    _register_errors(app)
    _register_cors(app, settings.cors_list)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # from src.modules.<modulo>.routes import bp as <modulo>_bp
    # app.register_blueprint(<modulo>_bp)
    return app


def _register_errors(app: Flask) -> None:
    """Errores siempre en JSON y sin trazas (un 500 nunca filtra detalles internos)."""

    @app.errorhandler(HTTPException)
    def http_error(e: HTTPException) -> tuple[Response, int]:
        return jsonify(error=e.description), e.code or 500

    @app.errorhandler(ValidationError)
    def validation_error(e: ValidationError) -> tuple[Response, int]:
        # Sin `input` ni `ctx`: no se devuelve lo que envió el cliente (podría ser un secreto).
        detail = e.errors(include_url=False, include_context=False, include_input=False)
        return jsonify(error="Datos inválidos", detail=detail), 422


def _register_cors(app: Flask, origins: list[str]) -> None:
    """CORS con orígenes explícitos (nunca `*` con credenciales)."""

    @app.after_request
    def cors(response: Response) -> Response:
        origin = request.headers.get("Origin")
        if origin and origin in origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.vary.add("Origin")
        return response


app = create_app()
PY

to_mongo conftest.py <<'PY'
"""Fixtures compartidas (zona del orquestador): `app`, `client` y `db` sobre MongoDB en memoria.

Vive en la raíz para que la vean los tests de `tests/` y los de `src/modules/*/tests/`.
MongoDB en memoria: mongomock, sin red ni BD real. Cada test recibe una base de datos vacía con
los índices declarados ya creados. Cuando exista auth, agrega aquí `user` y `auth_as(user)`
(ver flask-patterns/references/auth.md).
"""

from typing import Any

import mongomock
import pytest
from flask import Flask
from flask.testing import FlaskClient
from pymongo.database import Database

from src.core.db import create_indexes
from src.main import create_app


@pytest.fixture
def db() -> Database[Any]:
    database: Database[Any] = mongomock.MongoClient(tz_aware=True)["test"]
    create_indexes(database)
    return database


@pytest.fixture
def app(db: Database[Any]) -> Flask:
    app = create_app(database=db)
    app.config.update(TESTING=True)
    return app


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    return app.test_client()
PY

# Every file left under alembic/ is an untouched starter file (checked above).
for f in alembic.ini alembic; do
  if [ -e "$f" ]; then rm -rf "$f"; echo "  - $f"; fi
done
echo "mongo-setup OK: MongoDB (PyMongo)"
