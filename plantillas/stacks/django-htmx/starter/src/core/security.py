"""Content-Security-Policy en cada respuesta (settings.CONTENT_SECURITY_POLICY; vacío = apagado).

En prod solo permite el propio origen: htmx se sirve desde static/ y no usa eval
(htmx-config en templates/base.html). Nada de scripts ni estilos en línea en las plantillas.
"""

from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse


class ContentSecurityPolicyMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        policy: str = getattr(settings, "CONTENT_SECURITY_POLICY", "")
        if policy and "Content-Security-Policy" not in response:
            response["Content-Security-Policy"] = policy
        return response
