"""Punto de entrada. Registra aquí los routers de cada módulo (zona del orquestador)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.core.config import get_settings

settings = get_settings()
app = FastAPI(title="app", docs_url="/docs" if settings.app_env != "prod" else None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    return {"status": "ok"}


# from src.modules.<modulo>.router import router as <modulo>_router
# app.include_router(<modulo>_router)
