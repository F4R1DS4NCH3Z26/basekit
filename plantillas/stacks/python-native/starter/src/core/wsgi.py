"""Aplicación WSGI: router, errores siempre en JSON, CORS y una sesión de BD por petición."""

import logging
from collections.abc import Iterable
from wsgiref.types import StartResponse, WSGIEnvironment

from pydantic import ValidationError

from src.core.db import FACTORY_KEY, SessionFactory
from src.core.http import HTTPError, Request, Response, json_response
from src.core.router import Router

log = logging.getLogger("app")


class App:
    def __init__(
        self,
        router: Router,
        cors_origins: list[str],
        session_factory: SessionFactory | None = None,
    ) -> None:
        self.router = router
        self.cors_origins = cors_origins
        self.session_factory = session_factory

    def __call__(self, environ: WSGIEnvironment, start_response: StartResponse) -> Iterable[bytes]:
        request = Request(environ)
        request.state[FACTORY_KEY] = self.session_factory
        try:
            response = self.handle(request)
        finally:
            request.close()
        self._cors(request, response)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        body = b"" if request.method == "HEAD" or response.status in (204, 304) else response.body
        if response.status not in (204, 304):
            response.headers["Content-Length"] = str(len(body))
        start_response(response.status_line, list(response.headers.items()))
        return [body]

    def handle(self, request: Request) -> Response:
        try:
            if request.method == "OPTIONS":
                return self._options(request)
            return self.router.dispatch(request)
        except HTTPError as e:
            return json_response({"error": e.message}, e.status, e.headers)
        except ValidationError as e:
            # Sin `input` ni `ctx`: no se devuelve lo que envió el cliente (podría ser un secreto).
            detail = e.errors(include_url=False, include_context=False, include_input=False)
            return json_response({"error": "Datos inválidos", "detail": detail}, 422)
        except Exception:
            # 500 sin trazas: el detalle va al log, nunca al cliente.
            log.exception("Error no controlado en %s %s", request.method, request.path)
            return json_response({"error": "Error interno"}, 500)

    def _options(self, request: Request) -> Response:
        allowed = self.router.allowed(request.path)
        if not allowed:
            raise HTTPError(404)
        return Response(204, headers={"Allow": ", ".join(sorted(allowed | {"OPTIONS"}))})

    def _cors(self, request: Request, response: Response) -> None:
        """CORS con orígenes explícitos (nunca `*` con credenciales)."""
        origin = request.header("Origin")
        if origin and origin in self.cors_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Vary"] = "Origin"
