"""Punto de entrada WSGI (`gunicorn src.main:app`).

Incluye aquí el router de cada módulo (zona del orquestador).
"""

from src.core.config import get_settings
from src.core.db import SessionFactory, load_models
from src.core.http import Request, Response, json_response
from src.core.router import Router
from src.core.wsgi import App


def create_app(session_factory: SessionFactory | None = None) -> App:
    """Los tests pasan `session_factory` (SQLite en memoria); si no, sale de DATABASE_URL."""
    load_models()
    router = Router()

    @router.get("/health")
    def health(request: Request) -> Response:
        return json_response({"status": "ok"})

    # from src.modules.<modulo>.routes import router as <modulo>_router
    # router.include(<modulo>_router)
    return App(router, get_settings().cors_list, session_factory)


app = create_app()
