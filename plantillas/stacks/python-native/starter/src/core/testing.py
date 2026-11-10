"""Cliente de pruebas WSGI (stdlib): llama a la app sin red ni servidor.

Uso: `r = client.post("/products", json={"name": "A"})`, luego `r.status_code` y `r.json()`.
"""

import io
import json as jsonlib
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode
from wsgiref.types import WSGIApplication
from wsgiref.util import setup_testing_defaults


@dataclass
class TestResponse:
    __test__ = False  # pytest must not collect it as a test class

    status_code: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        return jsonlib.loads(self.body) if self.body else None


@dataclass
class TestClient:
    __test__ = False

    app: WSGIApplication
    headers: dict[str, str] = field(default_factory=dict)  # se envían en cada petición

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        data: bytes | None = None,
        query: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> TestResponse:
        body = data if data is not None else b""
        all_headers = {**self.headers, **(headers or {})}
        if json is not None:
            body = jsonlib.dumps(json).encode()
            all_headers.setdefault("Content-Type", "application/json")
        path, _, qs = path.partition("?")
        environ: dict[str, Any] = {
            "REQUEST_METHOD": method.upper(),
            "PATH_INFO": path,
            "QUERY_STRING": urlencode(query) if query else qs,
            "CONTENT_LENGTH": str(len(body)),
            "wsgi.input": io.BytesIO(body),
        }
        for name, value in all_headers.items():
            key = name.upper().replace("-", "_")
            environ[key if key == "CONTENT_TYPE" else f"HTTP_{key}"] = value
        setup_testing_defaults(environ)
        captured: dict[str, Any] = {}

        def start_response(status: str, response_headers: list[tuple[str, str]], *_: Any) -> Any:
            captured["status"] = int(status.split(" ", 1)[0])
            captured["headers"] = dict(response_headers)
            return lambda _data: None

        chunks = self.app(environ, start_response)
        try:
            payload = b"".join(chunks)
        finally:
            close = getattr(chunks, "close", None)
            if close is not None:
                close()
        return TestResponse(captured["status"], captured["headers"], payload)

    def get(self, path: str, **kw: Any) -> TestResponse:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw: Any) -> TestResponse:
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw: Any) -> TestResponse:
        return self.request("PUT", path, **kw)

    def patch(self, path: str, **kw: Any) -> TestResponse:
        return self.request("PATCH", path, **kw)

    def delete(self, path: str, **kw: Any) -> TestResponse:
        return self.request("DELETE", path, **kw)
