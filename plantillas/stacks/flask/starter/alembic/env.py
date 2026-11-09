"""Entorno de Alembic: URL desde DATABASE_URL y metadata de todos los `src/modules/*/models.py`."""

import importlib
import pkgutil
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool

from src.core.config import get_settings
from src.core.db import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Autogenerate only sees tables whose models were imported: load every module's models.py.
MODULES_DIR = Path(__file__).resolve().parents[1] / "src" / "modules"
for info in pkgutil.iter_modules([str(MODULES_DIR)]):
    if (MODULES_DIR / info.name / "models.py").is_file():
        importlib.import_module(f"src.modules.{info.name}.models")

target_metadata = Base.metadata


def _url() -> str:
    url = get_settings().database_url
    if url is None:
        raise RuntimeError("DATABASE_URL no está definida (configúrala con la skill infra-setup)")
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # The URL never goes through config.set_main_option: a "%" in the password breaks it.
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
