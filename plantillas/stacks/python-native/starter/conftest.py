"""Fixtures compartidas (zona del orquestador): `app`, `client` y `db` sobre SQLite en memoria.

Vive en la raíz para que la vean los tests de `tests/` y los de `src/modules/*/tests/`.
Cuando exista auth, agrega aquí `user` y `auth_as(user)` (ver pynative-patterns/references/auth.md).
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from src.core.db import Base, load_models
from src.core.testing import TestClient
from src.core.wsgi import App
from src.main import create_app


@pytest.fixture
def session_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    load_models()
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def app(session_factory: sessionmaker[Session]) -> App:
    return create_app(session_factory=session_factory)


@pytest.fixture
def client(app: App) -> TestClient:
    return TestClient(app)


@pytest.fixture
def db(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    with session_factory() as session:
        yield session
