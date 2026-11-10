# Auth en Django + DRF: usuario propio + SimpleJWT (access + refresh rotado)

## 1. Usuario propio, antes de la primera migración (orquestador)

Cambiar `AUTH_USER_MODEL` después de migrar es muy costoso. Antes de `make migration` por primera vez:

```bash
bash .agents/skills/django-scaffold/scripts/scaffold.sh accounts
```

`src/modules/accounts/models.py` (data-writer):

```python
import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)          # guardado en minúsculas por el service de registro
```

`src/config/settings.py` (orquestador): `"src.modules.accounts.apps.AccountsConfig"` en `INSTALLED_APPS` y `AUTH_USER_MODEL = "accounts.User"`. Después: `make migration NAME=initial` y `make migrate`. En `admin.py`, registra `User` con `django.contrib.auth.admin.UserAdmin`.

## 2. Dependencias (con aprobación del usuario)

```bash
make deps-add PKGS="djangorestframework-simplejwt>=5.4"
```

## 3. `src/config/settings.py` (orquestador)

```python
from datetime import timedelta

INSTALLED_APPS += ["rest_framework_simplejwt.token_blacklist"]   # guarda los refresh rotados
REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] = [
    "rest_framework_simplejwt.authentication.JWTAuthentication",
    "rest_framework.authentication.SessionAuthentication",       # solo para el admin y la API navegable
]
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] |= {"auth": "10/min"}

_jwt_secret = os.environ.get("JWT_SECRET", "")
if PROD and len(_jwt_secret) < 32:
    raise ImproperlyConfigured("JWT_SECRET debe tener al menos 32 caracteres (make env ENV=prod)")
SIMPLE_JWT = {
    "ALGORITHM": "HS256",                          # fijo: nunca se lee del token
    "SIGNING_KEY": _jwt_secret or SECRET_KEY,       # separada de SECRET_KEY en dev y prod
    "AUDIENCE": "app-clients",
    "ISSUER": "app",
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.environ.get("ACCESS_TOKEN_MINUTES", "15"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.environ.get("REFRESH_TOKEN_DAYS", "14"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,               # un refresh usado ya no sirve
    "UPDATE_LAST_LOGIN": True,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "sub",
}
```

`JWTAuthentication` consulta el usuario en cada petición y rechaza a los que tienen `is_active=False`: una cuenta desactivada deja de entrar en cuanto se desactiva, aunque su access token siga vigente.

## 4. Rutas (orquestador)

`src/core/auth_views.py`: las vistas de SimpleJWT con un límite propio (scope `auth`).

```python
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.views import TokenBlacklistView, TokenObtainPairView, TokenRefreshView


class LoginView(TokenObtainPairView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class RefreshView(TokenRefreshView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class LogoutView(TokenBlacklistView):
    pass
```

`src/config/urls.py`:

```python
from src.core.auth_views import LoginView, LogoutView, RefreshView

urlpatterns += [
    path("api/auth/login/", LoginView.as_view(), name="login"),
    path("api/auth/refresh/", RefreshView.as_view(), name="refresh"),
    path("api/auth/logout/", LogoutView.as_view(), name="logout"),
]
```

## 5. App `accounts` (delegada por roles)

**serializers.py** (data-writer):

- `RegisterSerializer`: `fields = ["email", "password"]`; `password = CharField(write_only=True, min_length=12, max_length=128)`; en `validate_password` llama a `django.contrib.auth.password_validation.validate_password`.
- `UserReadSerializer`: `fields = ["id", "email"]`, todo `read_only`. Nunca expongas `password`, `is_staff`, `is_superuser` ni `groups`.

**services.py** (logic-writer):

```python
@transaction.atomic
def register(*, email: str, password: str) -> User:
    email = email.strip().lower()
    if User.objects.filter(email=email).exists():
        raise EmailTaken()
    return User.objects.create_user(username=email, email=email, password=password)  # hash con el hasher de Django


def deactivate(*, user: User) -> None:
    """Cuenta desactivada: JWTAuthentication la rechaza y sus refresh se invalidan."""
    user.is_active = False
    user.save(update_fields=["is_active"])
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)
```

**views.py** (web-writer), prefijo `/api/auth/`:

| Método y ruta | Comportamiento |
|---|---|
| `POST /register/` | `AllowAny`, `throttle_classes = [ScopedRateThrottle]`, `throttle_scope = "auth"`. 201 → `UserReadSerializer`. Email repetido: 201 genérico o 409, según la ADR (enumeración). |
| `POST /login/` · `/refresh/` · `/logout/` | Vistas de SimpleJWT (paso 4). Credenciales incorrectas → 401 con el mismo mensaje exista o no el email. |
| `GET /me/` | `IsAuthenticated` → `UserReadSerializer(request.user)`. |

Si el cliente es un navegador, entrega el refresh en una cookie `httponly=True, secure=PROD, samesite="Lax", path="/api/auth/"`, no en el JSON, y protege `/refresh/` con CSRF.

**Rate limit**: `ScopedRateThrottle` con el scope `auth`, que usa la caché (Redis si activaste `--redis`; si no, es por proceso). Detrás de un proxy, DRF identifica al cliente por `REMOTE_ADDR`; configura `NUM_PROXIES` en `REST_FRAMEWORK` con el número exacto de proxies de confianza, nunca más, o cualquiera falsifica `X-Forwarded-For` y esquiva el límite. Además del límite por IP, cuenta los intentos fallidos por email normalizado: frena ataques distribuidos contra una cuenta, a cambio de que alguien pueda bloquear el login de otra persona a propósito (usa un límite por cuenta más alto o un captcha tras N fallos si te afecta). Documenta la decisión en `docs/AUTH.md`.

## Tests obligatorios (qa-writer)

- Login con contraseña incorrecta → 401, con el mismo mensaje para email inexistente y para cuenta desactivada.
- Token con `alg` distinto, expirado o con `aud` incorrecto → 401.
- Refresh rotado y reutilizado → 401.
- Usuario desactivado: su access token → 401 y su refresh → 401.
- Logout → ese refresh ya no sirve.
- Registro con campos extra (`is_staff: true`) → el usuario creado no es staff.
