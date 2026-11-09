"""Configuración tipada desde variables de entorno (nunca leas .env a mano).

Solo stdlib: un dataclass inmutable que se construye una vez con `get_settings()`.
"""

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def normalize_database_url(url: str) -> str | None:
    """El overlay de BD entrega URLs genéricas; SQLAlchemy necesita el driver explícito."""
    if not url:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("mysql://"):
        return url.replace("mysql://", "mysql+pymysql://", 1)
    if url.startswith("file:"):
        return "sqlite:///" + url.removeprefix("file:")
    return url


@dataclass(frozen=True)
class Settings:
    app_env: str = field(default_factory=lambda: _env("APP_ENV", "dev"))
    cors_origins: str = field(default_factory=lambda: _env("CORS_ORIGINS", "http://localhost:3000"))
    database_url: str | None = field(
        default_factory=lambda: normalize_database_url(_env("DATABASE_URL"))
    )
    redis_url: str | None = field(default_factory=lambda: _env("REDIS_URL") or None)

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
