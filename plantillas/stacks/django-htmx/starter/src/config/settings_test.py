"""Settings de pytest y mypy: SQLite en memoria, sin red ni BD real (también en `make verify`)."""

import os

os.environ.setdefault("APP_ENV", "test")

from src.config.settings import *  # noqa: E402,F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
# Fast tests only, never in prod.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
