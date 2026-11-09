"""Configuración tipada desde variables de entorno (nunca leas .env a mano)."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    app_env: str = "dev"
    secret_key: str = ""
    cors_origins: str = "http://localhost:3000"
    database_url: str | None = None
    redis_url: str | None = None

    @field_validator("database_url")
    @classmethod
    def _sqlalchemy_driver(cls, v: str | None) -> str | None:
        # El overlay de BD entrega URLs genéricas; SQLAlchemy necesita el driver explícito.
        if not v:
            return None
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+psycopg://", 1)
        if v.startswith("mysql://"):
            return v.replace("mysql://", "mysql+pymysql://", 1)
        if v.startswith("file:"):
            return "sqlite:///" + v.removeprefix("file:")
        return v

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
