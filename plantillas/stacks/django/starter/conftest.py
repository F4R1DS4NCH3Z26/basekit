"""Fixtures compartidos de pytest (orquestador): api_client, user, other_user, auth_as.

Vive en la raíz para que lo vean todos los tests, también los de src/modules/*/tests/.
"""

from collections.abc import Callable
from typing import Any

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient


def make_user(username: str) -> Any:
    # _default_manager keeps this valid when AUTH_USER_MODEL points to a custom model.
    manager: Any = get_user_model()._default_manager
    return manager.create_user(
        username=username, email=f"{username}@example.com", password="test-password-123"
    )


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def user(db: None) -> Any:
    return make_user("ana")


@pytest.fixture
def other_user(db: None) -> Any:
    return make_user("bruno")


@pytest.fixture
def auth_as(api_client: APIClient) -> Callable[[Any], None]:
    """auth_as(user): las siguientes peticiones de api_client van autenticadas como ese usuario."""

    def _auth(u: Any) -> None:
        api_client.force_authenticate(user=u)

    return _auth
