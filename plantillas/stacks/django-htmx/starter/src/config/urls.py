"""Rutas raíz. Registra aquí las urls de cada app (zona del orquestador).

/health vive en src/core/health.py (middleware). Login y logout son las vistas de sesión
de django.contrib.auth (djhtmx-patterns/references/auth.md).
"""

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import URLPattern, URLResolver, path

from src.core.views import home

urlpatterns: list[URLPattern | URLResolver] = [
    path("", home, name="home"),
    path(
        "login/",
        auth_views.LoginView.as_view(redirect_authenticated_user=True),
        name="login",
    ),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),  # POST only, with CSRF
    path(settings.ADMIN_URL, admin.site.urls),
    # path("<modulo>/", include("src.modules.<modulo>.urls")),
]
