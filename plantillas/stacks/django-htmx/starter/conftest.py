"""Fixtures compartidos de pytest (orquestador): user, other_user, login_as, csrf_client.

Vive en la raíz para que lo vean todos los tests, también los de src/modules/*/tests/.
`client` (django.test.Client) lo da pytest-django; no aplica CSRF. `csrf_client` sí lo aplica.
"""

from collections.abc import Callable
from typing import Any

import pytest
from django.contrib.auth import get_user_model
from django.test import Client


def make_user(username: str) -> Any:
    # _default_manager keeps this valid when AUTH_USER_MODEL points to a custom model.
    manager: Any = get_user_model()._default_manager
    return manager.create_user(
        username=username, email=f"{username}@example.com", password="test-password-123"
    )


@pytest.fixture
def user(db: None) -> Any:
    return make_user("ana")


@pytest.fixture
def other_user(db: None) -> Any:
    return make_user("bruno")


@pytest.fixture
def login_as(client: Client) -> Callable[[Any], None]:
    """login_as(user): las siguientes peticiones de `client` van con la sesión de ese usuario."""

    def _login(u: Any) -> None:
        client.force_login(u)

    return _login


@pytest.fixture
def csrf_client() -> Client:
    """Cliente que exige el token CSRF, como un navegador real (sin token → 403)."""
    return Client(enforce_csrf_checks=True)
