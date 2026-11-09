"""Configuración de Django desde variables de entorno (nunca leas .env a mano).

Lo que cambia entre entornos (APP_ENV y, con él, DEBUG) lo fija compose, no .env.
La base de datos llega de los overlays de infra-setup (compose.db.yaml):
DB_DRIVER + DB_* o DATABASE_URL.
"""

import contextlib
import os
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

import django_stubs_ext
from django.core.exceptions import ImproperlyConfigured
from django.core.management.utils import get_random_secret_key

# Generic Django classes at runtime (admin.ModelAdmin[Product]), as django-stubs types them.
django_stubs_ext.monkeypatch()

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Secure by default: without APP_ENV the app behaves as production (no DEBUG, required secret key).
APP_ENV = os.environ.get("APP_ENV", "prod")
PROD = APP_ENV == "prod"
DEBUG = APP_ENV == "dev"


def env_list(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if PROD:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY no está configurada (make env ENV=prod)")
    SECRET_KEY = get_random_secret_key()  # dev/test only: ephemeral, sessions end on restart

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
# Explicit origins, never "*" with credentials.
CORS_ALLOWED_ORIGINS = env_list("CORS_ORIGINS", "http://localhost:3000")
CORS_ALLOW_CREDENTIALS = True
ADMIN_URL = os.environ.get("ADMIN_URL", "admin/").strip("/") + "/"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    # Apps of the project (orchestrator): "src.modules.<m>",
]

MIDDLEWARE = [
    "src.core.health.HealthCheckMiddleware",  # first: /health answers before host validation
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise only in prod (staticfiles/ is collected in the image); runserver serves dev.
    *(["whitenoise.middleware.WhiteNoiseMiddleware"] if PROD else []),
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "src.config.urls"
WSGI_APPLICATION = "src.config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

_ENGINES = {
    "postgres": "django.db.backends.postgresql",
    "mysql": "django.db.backends.mysql",
    "sqlite": "django.db.backends.sqlite3",
}
_SCHEMES = {
    "postgres": "postgres",
    "postgresql": "postgres",
    "mysql": "mysql",
    "file": "sqlite",
    "sqlite": "sqlite",
}
_DEFAULT_SQLITE = BASE_DIR / "data" / "app.db"


def database() -> dict[str, Any]:
    """Connection from the infra-setup overlay: DB_DRIVER + DB_*, then DATABASE_URL, else SQLite."""
    env = os.environ
    driver = env.get("DB_DRIVER", "")
    name, user, password = (
        env.get("DB_DATABASE", ""),
        env.get("DB_USERNAME", ""),
        env.get("DB_PASSWORD", ""),
    )
    host, port = env.get("DB_HOST", ""), env.get("DB_PORT", "")
    url = env.get("DATABASE_URL", "")
    if not driver and url:
        parts = urlsplit(url)
        driver = _SCHEMES.get(parts.scheme, "")
        if not driver:
            raise ImproperlyConfigured(f"DATABASE_URL con esquema no soportado: {parts.scheme}")
        if driver == "sqlite":
            name = parts.path
        else:
            name, host, port = parts.path.lstrip("/"), parts.hostname or "", str(parts.port or "")
            user, password = unquote(parts.username or ""), unquote(parts.password or "")
    if not driver:
        driver = "sqlite"  # no database overlay yet: a local file, so the admin still works in dev
    if driver not in _ENGINES:
        raise ImproperlyConfigured(f"DB_DRIVER no soportado: {driver}")
    if driver == "sqlite":
        path = Path(name) if name else _DEFAULT_SQLITE
        # Read-only filesystem: the directory is not created and the first query fails.
        with contextlib.suppress(OSError):
            path.parent.mkdir(parents=True, exist_ok=True)
        return {"ENGINE": _ENGINES[driver], "NAME": str(path)}
    options: dict[str, Any] = {}
    if driver == "mysql":
        # PyMySQL (pure Python, no compiler in the image) stands in for mysqlclient.
        # Django 5.2 checks the mysqlclient version (>= 2.2.1); PyMySQL reports an older one.
        import pymysql

        pymysql.version_info = (2, 2, 1, "final", 0)
        pymysql.install_as_MySQLdb()
        options = {"charset": "utf8mb4"}
    return {
        "ENGINE": _ENGINES[driver],
        "NAME": name,
        "USER": user,
        "PASSWORD": password,
        "HOST": host,
        "PORT": port,
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": options,
    }


DATABASES = {"default": database()}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Redis from its overlay (compose.redis.yaml): shared cache, so DRF throttling works across workers.
REDIS_URL = os.environ.get("REDIS_URL", "")
CACHES = {
    "default": (
        {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}
        if REDIS_URL
        else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "es"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": (
            "whitenoise.storage.CompressedManifestStaticFilesStorage"
            if PROD
            else "django.contrib.staticfiles.storage.StaticFilesStorage"
        )
    },
}

REST_FRAMEWORK = {
    # Deny by default: every view states its own permission_classes when it opens up.
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    # SimpleJWT adds its class here (django-patterns/references/auth.md).
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PAGINATION_CLASS": "src.core.pagination.DefaultPagination",
    "DEFAULT_RENDERER_CLASSES": (
        ["rest_framework.renderers.JSONRenderer", "rest_framework.renderers.BrowsableAPIRenderer"]
        if DEBUG
        else ["rest_framework.renderers.JSONRenderer"]
    ),
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {"anon": "60/min", "user": "600/min"},
}

if PROD:
    # TLS ends at the reverse proxy, which must send X-Forwarded-Proto.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "0"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}
