"""Router propio: rutas `/products/{product_id:uuid}` → handler(request, **params).

Convertidores: `str` (por defecto, sin `/`), `int` y `uuid`. Un valor que no convierte es 404.
Cada módulo tiene su `router = Router("/prefijo")`; `src/main.py` los incluye.
"""

import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from src.core.http import HTTPError, Request, Response

Handler = Callable[..., Response]

_CONVERTERS: dict[str, tuple[str, Callable[[str], Any]]] = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "uuid": (r"[0-9a-fA-F]{8}-?(?:[0-9a-fA-F]{4}-?){3}[0-9a-fA-F]{12}", uuid.UUID),
}
_PARAM = re.compile(r"\{([a-z_][a-z0-9_]*)(?::([a-z]+))?\}")


@dataclass(frozen=True)
class Route:
    method: str
    template: str
    pattern: re.Pattern[str]
    converters: dict[str, Callable[[str], Any]]
    handler: Handler


def _compile(template: str) -> tuple[re.Pattern[str], dict[str, Callable[[str], Any]]]:
    regex, converters, pos = "", {}, 0
    for m in _PARAM.finditer(template):
        name, kind = m.group(1), m.group(2) or "str"
        if kind not in _CONVERTERS:
            raise ValueError(f"Convertidor desconocido '{kind}' en {template}")
        part, conv = _CONVERTERS[kind]
        regex += re.escape(template[pos : m.start()]) + f"(?P<{name}>{part})"
        converters[name] = conv
        pos = m.end()
    regex += re.escape(template[pos:])
    return re.compile(regex), converters


class Router:
    def __init__(self, prefix: str = "") -> None:
        self.prefix = prefix.rstrip("/")
        self.routes: list[Route] = []

    def route(self, method: str, path: str) -> Callable[[Handler], Handler]:
        template = (self.prefix + path) or "/"

        def register(handler: Handler) -> Handler:
            pattern, converters = _compile(template)
            self.routes.append(Route(method.upper(), template, pattern, converters, handler))
            return handler

        return register

    def get(self, path: str) -> Callable[[Handler], Handler]:
        return self.route("GET", path)

    def post(self, path: str) -> Callable[[Handler], Handler]:
        return self.route("POST", path)

    def put(self, path: str) -> Callable[[Handler], Handler]:
        return self.route("PUT", path)

    def patch(self, path: str) -> Callable[[Handler], Handler]:
        return self.route("PATCH", path)

    def delete(self, path: str) -> Callable[[Handler], Handler]:
        return self.route("DELETE", path)

    def include(self, other: "Router") -> None:
        """Agrega las rutas de otro router (las de un módulo)."""
        self.routes.extend(other.routes)

    def allowed(self, path: str) -> set[str]:
        """Métodos con una ruta para ese path (para 405 y OPTIONS)."""
        methods = {r.method for r in self.routes if r.pattern.fullmatch(path)}
        return methods | {"HEAD"} if "GET" in methods else methods

    def dispatch(self, request: Request) -> Response:
        method = "GET" if request.method == "HEAD" else request.method
        for r in self.routes:
            if r.method != method:
                continue
            m = r.pattern.fullmatch(request.path)
            if m is None:
                continue
            try:
                params = {k: r.converters[k](v) for k, v in m.groupdict().items()}
            except ValueError:
                raise HTTPError(404) from None
            request.params = params
            return r.handler(request, **params)
        allowed = self.allowed(request.path)
        if allowed:
            raise HTTPError(405, headers={"Allow": ", ".join(sorted(allowed | {"OPTIONS"}))})
        raise HTTPError(404)
