"""Fixtures compartidas (zona del orquestador): `app`, `client` y `db` sobre SQLite en memoria.

Vive en la raíz para que la vean los tests de `tests/` y los de `src/modules/*/tests/`.
Cuando exista auth, agrega aquí `user` y `auth_as(user)` (ver flask-patterns/references/auth.md).
"""

from collections.abc import Iterator

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from src.core.db import Base
from src.main import create_app


@pytest.fixture
def session_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def app(session_factory: sessionmaker[Session]) -> Flask:
    app = create_app(session_factory=session_factory)
    app.config.update(TESTING=True)
    return app


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    return app.test_client()


@pytest.fixture
def db(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    with session_factory() as session:
        yield session
