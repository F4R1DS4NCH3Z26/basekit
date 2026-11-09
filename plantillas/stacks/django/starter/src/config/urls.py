"""Rutas raíz. Registra aquí las urls de cada app (zona del orquestador).

/health vive en src/core/health.py (middleware).
"""

from django.conf import settings
from django.contrib import admin
from django.urls import URLPattern, URLResolver, path

urlpatterns: list[URLPattern | URLResolver] = [
    path(settings.ADMIN_URL, admin.site.urls),
    # path("api/<modulo>/", include("src.modules.<modulo>.urls")),
]
