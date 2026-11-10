"""Petición y respuesta HTTP sobre WSGI (PEP 3333), solo con la stdlib.

`Request` envuelve el `environ`; `Response` es lo que devuelve cada handler;
`HTTPError` corta un handler con un código y un mensaje (siempre JSON).
"""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any
from urllib.parse import parse_qs
from wsgiref.types import WSGIEnvironment

MAX_BODY_BYTES = 1024 * 1024


class HTTPError(Exception):
    """`raise HTTPError(404)` o `raise HTTPError(401, "No autenticado")` → `{"error": …}`."""

    def __init__(
        self, status: int, message: str | None = None, headers: dict[str, str] | None = None
    ) -> None:
        self.status = status
        self.message = message or HTTPStatus(status).phrase
        self.headers = headers or {}
        super().__init__(self.message)


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    headers: dict[str, str] = field(default_factory=dict)

    @property
    def status_line(self) -> str:
        return f"{self.status} {HTTPStatus(self.status).phrase}"


def json_response(data: Any, status: int = 200, headers: dict[str, str] | None = None) -> Response:
    """Serializa con `json` de la stdlib.

    Pasa antes la salida por el schema de lectura (`model_dump(mode="json")`).
    """
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    h = {"Content-Type": "application/json; charset=utf-8", **(headers or {})}
    return Response(status=status, body=body, headers=h)


def no_content() -> Response:
    return Response(status=204)


class Request:
    def __init__(self, environ: WSGIEnvironment) -> None:
        self.environ = environ
        self.method: str = environ.get("REQUEST_METHOD", "GET").upper()
        self.path: str = environ.get("PATH_INFO", "") or "/"
        self.params: dict[str, Any] = {}  # parámetros de ruta, ya convertidos por el router
        self.state: dict[str, object] = {}  # datos de la petición (sesión de BD, usuario…)
        self._on_close: list[Callable[[], None]] = []
        self._body: bytes | None = None

    def header(self, name: str, default: str = "") -> str:
        key = name.upper().replace("-", "_")
        if key in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            return str(self.environ.get(key, default))
        return str(self.environ.get(f"HTTP_{key}", default))

    @property
    def query(self) -> dict[str, str]:
        """Query string con el primer valor de cada clave: `?limit=20&offset=0`."""
        raw = parse_qs(self.environ.get("QUERY_STRING", ""), keep_blank_values=True)
        return {k: v[0] for k, v in raw.items()}

    @property
    def remote_addr(self) -> str:
        return str(self.environ.get("REMOTE_ADDR", ""))

    def body(self) -> bytes:
        """Cuerpo crudo, como máximo MAX_BODY_BYTES (413 si es mayor)."""
        if self._body is None:
            stream = self.environ["wsgi.input"]
            length = self.header("Content-Length")
            if length:
                try:
                    size = int(length)
                except ValueError:
                    raise HTTPError(400, "Content-Length inválido") from None
                if size < 0:
                    raise HTTPError(400, "Content-Length inválido")
                if size > MAX_BODY_BYTES:
                    raise HTTPError(413)
                self._body = stream.read(size) if size else b""
            elif self.environ.get("wsgi.input_terminated"):
                # Chunked transfer: el servidor marca el final del stream; se lee con tope.
                data = stream.read(MAX_BODY_BYTES + 1)
                if len(data) > MAX_BODY_BYTES:
                    raise HTTPError(413)
                self._body = data
            else:
                self._body = b""
        return self._body

    def json(self) -> Any:
        """Cuerpo JSON. Vacío → None; otro Content-Type → 415; JSON roto → 400."""
        raw = self.body()
        if not raw:
            return None
        if self.header("Content-Type").split(";")[0].strip().lower() != "application/json":
            raise HTTPError(415, "Se espera Content-Type: application/json")
        try:
            return json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise HTTPError(400, "JSON inválido") from None

    def call_on_close(self, fn: Callable[[], None]) -> None:
        """Registra limpieza al terminar la petición (p. ej. cerrar la sesión de BD)."""
        self._on_close.append(fn)

    def close(self) -> None:
        while self._on_close:
            self._on_close.pop()()
