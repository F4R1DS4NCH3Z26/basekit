"""Ayudas de HTMX (django-htmx): tipos de request, página completa o parcial, y login en HTMX.

- `HtmxRequest`: HttpRequest con `request.htmx` (lo pone django_htmx.middleware.HtmxMiddleware).
- `AuthedHtmxRequest`: para vistas con @login_required, donde `request.user` ya es un usuario.
- `render_page()`: la página completa en una petición normal y solo el parcial en una de HTMX.
- `HtmxLoginRedirectMiddleware`: una petición HTMX sin sesión recibe HX-Redirect al login,
  en lugar de que htmx pegue la página de login dentro del fragmento.
"""

from collections.abc import Callable, Mapping
from typing import Any

from django.conf import settings
from django.contrib.auth.models import User  # with a custom user: src.modules.accounts.models
from django.http import HttpRequest, HttpResponse, HttpResponseBase
from django.shortcuts import render, resolve_url
from django.utils.cache import patch_vary_headers
from django_htmx.http import HttpResponseClientRedirect
from django_htmx.middleware import HtmxDetails


class HtmxRequest(HttpRequest):
    htmx: HtmxDetails


class AuthedHtmxRequest(HtmxRequest):
    user: User  # only under @login_required


def wants_partial(request: HtmxRequest) -> bool:
    """HTMX swaps a fragment, except on a history restore (it needs the whole page)."""
    return bool(request.htmx) and not request.htmx.history_restore_request


def render_page(
    request: HtmxRequest,
    page: str,
    partial: str,
    context: Mapping[str, Any] | None = None,
    status: int = 200,
) -> HttpResponse:
    """`page` extends base.html and includes `partial`; HTMX only gets `partial`."""
    template = partial if wants_partial(request) else page
    response = render(request, template, context, status=status)
    patch_vary_headers(response, ("HX-Request",))  # caches must not mix page and fragment
    return response


class HtmxLoginRedirectMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response

    def __call__(self, request: HtmxRequest) -> HttpResponseBase:
        response = self.get_response(request)
        login = str(resolve_url(settings.LOGIN_URL))
        location = response.get("Location", "") if response.status_code == 302 else ""
        if getattr(request, "htmx", False) and location.startswith(login):
            return HttpResponseClientRedirect(location)
        return response
