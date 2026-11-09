"""Base declarativa de SQLAlchemy 2, carga de modelos y una sesión por petición (`get_db`)."""

import importlib
import pkgutil
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.core.config import get_settings


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
def default_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Sesión de la petición actual. El engine se crea en el primer uso, no al importar.

    Los tests la reemplazan con `app.dependency_overrides[get_db]` (SQLite en memoria,
    ver conftest.py).
    """
    with default_factory()() as session:
        yield session
