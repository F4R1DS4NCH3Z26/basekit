"""Base declarativa de SQLAlchemy 2, carga de modelos y una sesión por petición."""

import importlib
import pkgutil
from functools import lru_cache
from pathlib import Path

from flask import Flask, current_app, g
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.core.config import get_settings

FACTORY_KEY = "db_session_factory"


class Base(DeclarativeBase):
    pass


MODULES_DIR = Path(__file__).resolve().parents[1] / "modules"


def load_models() -> None:
    """Importa todos los `src/modules/*/models.py`.

    Una FK entre módulos (products → users) solo resuelve si las dos tablas están en
    `Base.metadata`; la app (`create_app`), los tests (`conftest.py`) y Alembic llaman a esto
    antes de usar el ORM.
    """
    for info in pkgutil.iter_modules([str(MODULES_DIR)]):
        if (MODULES_DIR / info.name / "models.py").is_file():
            importlib.import_module(f"src.modules.{info.name}.models")


@lru_cache
def get_engine() -> Engine:
    url = get_settings().database_url
    if url is None:
        raise RuntimeError("DATABASE_URL no está definida (configúrala con la skill infra-setup)")
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})
    return create_engine(url, pool_pre_ping=True)


@lru_cache
def _default_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_db() -> Session:
    """Sesión de la petición actual. El engine se crea en el primer uso, no al importar."""
    if "db" not in g:
        factory: sessionmaker[Session] = current_app.extensions[FACTORY_KEY] or _default_factory()
        g.db = factory()
    session: Session = g.db
    return session


def _close_db(_exc: BaseException | None) -> None:
    session: Session | None = g.pop("db", None)
    if session is not None:
        session.close()


def init_app(app: Flask, session_factory: sessionmaker[Session] | None = None) -> None:
    """Los tests pasan `session_factory` (SQLite en memoria); si no, sale de DATABASE_URL."""
    app.extensions[FACTORY_KEY] = session_factory
    app.teardown_appcontext(_close_db)
