"""GET /health: lo usan el HEALTHCHECK de Docker y los balanceadores.

Es un middleware y va primero en MIDDLEWARE: responde antes de validar el host
(ALLOWED_HOSTS) y sin tocar la base de datos, así el healthcheck sobre 127.0.0.1
funciona aunque en prod solo se acepte tu dominio.
"""

from collections.abc import Callable

from django.http import HttpRequest, HttpResponse, JsonResponse


class HealthCheckMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if request.path == "/health" and request.method in ("GET", "HEAD"):
            return JsonResponse({"status": "ok"})
        return self.get_response(request)
