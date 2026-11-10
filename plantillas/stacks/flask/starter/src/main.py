"""Punto de entrada. Registra aquí los blueprints de cada módulo (zona del orquestador)."""

from flask import Flask, Response, jsonify, request
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import HTTPException

from src.core import db
from src.core.config import get_settings

MAX_BODY_BYTES = 1024 * 1024


def create_app(session_factory: sessionmaker[Session] | None = None) -> Flask:
    settings = get_settings()
    # Todos los modelos antes del primer uso del ORM: así resuelven las FK entre módulos.
    db.load_models()
    app = Flask(__name__)
    app.config.update(SECRET_KEY=settings.secret_key, MAX_CONTENT_LENGTH=MAX_BODY_BYTES)
    db.init_app(app, session_factory)
    _register_errors(app)
    _register_cors(app, settings.cors_list)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # from src.modules.<modulo>.routes import bp as <modulo>_bp
    # app.register_blueprint(<modulo>_bp)
    return app


def _register_errors(app: Flask) -> None:
    """Errores siempre en JSON y sin trazas (un 500 nunca filtra detalles internos)."""

    @app.errorhandler(HTTPException)
    def http_error(e: HTTPException) -> tuple[Response, int]:
        return jsonify(error=e.description), e.code or 500

    @app.errorhandler(ValidationError)
    def validation_error(e: ValidationError) -> tuple[Response, int]:
        # Sin `input` ni `ctx`: no se devuelve lo que envió el cliente (podría ser un secreto).
        detail = e.errors(include_url=False, include_context=False, include_input=False)
        return jsonify(error="Datos inválidos", detail=detail), 422


def _register_cors(app: Flask, origins: list[str]) -> None:
    """CORS con orígenes explícitos (nunca `*` con credenciales)."""

    @app.after_request
    def cors(response: Response) -> Response:
        origin = request.headers.get("Origin")
        if origin and origin in origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.vary.add("Origin")
        return response


app = create_app()
