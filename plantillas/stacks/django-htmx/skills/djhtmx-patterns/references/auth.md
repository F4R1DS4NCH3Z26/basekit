# Auth en Django + HTMX: sesión de Django (login y logout con CSRF)

Una app de plantillas del servidor no necesita JWT: el navegador ya guarda la cookie de sesión (`HttpOnly`, `SameSite=Lax`, `Secure` en prod) y cada formulario lleva su token CSRF. Este documento dice qué trae el esqueleto y qué agregar.

## 1. Lo que ya trae el esqueleto (orquestador)

| Pieza | Dónde |
|---|---|
| `LoginView` (`redirect_authenticated_user=True`) en `/login/` y `LogoutView` (solo POST) en `/logout/` | `src/config/urls.py` |
| `LOGIN_URL = "login"`, `LOGIN_REDIRECT_URL = "home"`, `LOGOUT_REDIRECT_URL = "login"`, `SESSION_COOKIE_AGE` (de `.env`) | `src/config/settings.py` |
| Cookies: sesión `HttpOnly` + `SameSite=Lax`; CSRF `HttpOnly` (htmx no lee la cookie: el token va en `hx-headers`); ambas `Secure` en prod | `src/config/settings.py` |
| Formulario de login (POST normal, sin HTMX: Django rota la sesión y redirige a `?next=`, que valida contra el host) | `templates/registration/login.html` |
| Botón "Salir": un `<form method="post">` con `{% csrf_token %}` | `templates/base.html` |
| Petición HTMX sin sesión → `HX-Redirect` al login (htmx recarga la página entera) | `src/core/htmx.py` (`HtmxLoginRedirectMiddleware`) |
| Validadores de contraseña: mínimo 12, no común, no numérica, no parecida al usuario | `AUTH_PASSWORD_VALIDATORS` |

Cada vista con datos lleva `@login_required`; las de staff, además `@permission_required("app.permiso", raise_exception=True)` (403, no redirección). El admin (`ADMIN_URL`) solo deja entrar a cuentas `is_staff`.

## 2. Usuario propio, antes de la primera migración (orquestador)

Si el proyecto necesitará campos propios en el usuario (email como login, UUID), decídelo **antes** de `make migrate`: cambiar `AUTH_USER_MODEL` después exige rehacer las migraciones.

1. `bash .agents/skills/djhtmx-scaffold/scripts/scaffold.sh accounts`.
2. `models.py` (data-writer): `class User(AbstractUser)` con `id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` y `email = models.EmailField(unique=True)`.
3. `settings.py`: `AUTH_USER_MODEL = "accounts.User"`. En `src/core/htmx.py`, `AuthedHtmxRequest.user` y los `services.py` importan ese `User`.
4. `make migration NAME=create_accounts` y luego `make migrate`.

## 3. Registro de cuentas (si el contrato lo pide)

- **forms.py** (views-writer): `SignupForm(forms.Form)` con `email = forms.EmailField()`, `password1`/`password2 = forms.CharField(widget=forms.PasswordInput, strip=False, max_length=128)`; en `clean()` compara las dos y llama a `django.contrib.auth.password_validation.validate_password(password1)`. Nunca un `ModelForm` del usuario con `is_staff`, `is_superuser` o `groups`.
- **services.py** (logic-writer): `register(*, email: str, password: str) -> User` dentro de `transaction.atomic()`; normaliza el email (`strip().lower()`), lanza `EmailTaken` si existe y crea con `create_user` (hash del hasher de Django).
- **views.py** (views-writer): `@require_http_methods(["GET", "POST"])`; si es válido, `services.register(...)`, luego `django.contrib.auth.login(request, user)` (rota la sesión) y `redirect(settings.LOGIN_REDIRECT_URL)`. Con errores, el mismo parcial y 422. `EmailTaken` se muestra como error del campo, con el mismo texto que un email inválido si no quieres revelar qué cuentas existen.

## 4. Fuerza bruta en el login

Django no limita los intentos de login. Antes de producción agrega `django-axes` (bloquea por usuario e IP tras N fallos):

```bash
make deps-add PKGS="django-axes==8.3.1"   # versión con ≥ 14 días; confirma que soporta tu Django
```

Sigue su guía de instalación (`AUTHENTICATION_BACKENDS` con `axes.backends.AxesStandaloneBackend` primero, su middleware al final y `make migrate`). Detrás de un proxy, configura la IP real del cliente (cabecera del proxy de confianza), o bloquearás a todos por la IP del proxy.

## 5. Producción

- `ALLOWED_HOSTS` con tu dominio y `CSRF_TRUSTED_ORIGINS=https://tu-dominio` (el proxy TLS termina HTTPS y envía `X-Forwarded-Proto`).
- `SESSION_COOKIE_AGE` en `.env.prod` (por defecto 14 días). Para cerrar todas las sesiones: cambia `DJANGO_SECRET_KEY` o borra la tabla `django_session`.
- Nunca guardes datos sensibles en la sesión ni en `localStorage`: `htmx-config` ya pone `historyCacheSize: 0` para que htmx no copie páginas privadas al navegador.

## Tests obligatorios (qa-writer, `tests/test_auth.py`)

```python
import re
from typing import Any

import pytest
from django.test import Client


def csrf_from(html: bytes) -> str:
    match = re.search(rb'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    assert match
    return match.group(1).decode()


@pytest.mark.django_db
def test_login_with_csrf_starts_a_session(csrf_client: Client, user: Any) -> None:
    token = csrf_from(csrf_client.get("/login/").content)
    data = {"username": "ana", "password": "test-password-123", "csrfmiddlewaretoken": token}
    r = csrf_client.post("/login/", data)
    assert r.status_code == 302 and r["Location"] == "/"
    assert "_auth_user_id" in csrf_client.session


@pytest.mark.django_db
def test_login_without_csrf_is_403(csrf_client: Client, user: Any) -> None:
    r = csrf_client.post("/login/", {"username": "ana", "password": "test-password-123"})
    assert r.status_code == 403


@pytest.mark.django_db
def test_wrong_password_shows_the_error(client: Client, user: Any) -> None:
    r = client.post("/login/", {"username": "ana", "password": "nope"})
    assert r.status_code == 200 and b"errorlist" in r.content
    assert "_auth_user_id" not in client.session


def test_logout_is_post_only(client: Client, user: Any) -> None:
    client.force_login(user)
    assert client.get("/logout/").status_code == 405
    assert client.post("/logout/").status_code == 302
    assert "_auth_user_id" not in client.session
```
