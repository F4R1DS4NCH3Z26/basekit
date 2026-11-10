# Auth en la API Python nativa: JWT de acceso + refresh rotado

SQLAlchemy 2, Alembic y los drivers ya vienen en el esqueleto. Sin framework, la auth es código propio en `src/core/security.py`; solo el JWT y el hash de contraseñas son librerías. Dependencias (con aprobación del usuario):

```bash
make deps-add PKGS="pyjwt==<versión con ≥ 14 días> pwdlib[argon2]==<versión con ≥ 14 días> email-validator==<versión con ≥ 14 días>"
```

## `src/core/config.py`: agrega a `Settings` (orquestador)

```python
    jwt_secret: str = field(default_factory=lambda: _env("JWT_SECRET"))
    jwt_issuer: str = field(default_factory=lambda: _env("JWT_ISSUER", "app"))
    jwt_audience: str = field(default_factory=lambda: _env("JWT_AUDIENCE", "app-clients"))
    access_token_minutes: int = field(
        default_factory=lambda: int(_env("ACCESS_TOKEN_MINUTES", "15"))
    )
    refresh_token_days: int = field(default_factory=lambda: int(_env("REFRESH_TOKEN_DAYS", "14")))

    def __post_init__(self) -> None:
        # `make env` lo genera con 32 bytes aleatorios en hex; uno corto se rechaza al arrancar.
        if len(self.jwt_secret) < 32:
            raise RuntimeError("JWT_SECRET debe tener al menos 32 caracteres")
```

## `src/core/security.py` (orquestador)

Sin decoradores: cada handler protegido empieza con `user = require_user(request)`. Es explícito y mypy lo tipa sin trucos.

```python
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from src.core.config import get_settings
from src.core.http import HTTPError, Request

ALGORITHM = "HS256"                       # fijo: nunca se lee del token
USER_KEY = "user"
_hasher = PasswordHash.recommended()      # argon2id
DUMMY_HASH = _hasher.hash("timing-equalizer")
UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    roles: tuple[str, ...]


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _hasher.verify(password, hashed)


def create_access_token(user_id: uuid.UUID, roles: list[str]) -> str:
    s, now = get_settings(), datetime.now(UTC)
    payload = {"sub": str(user_id), "roles": roles, "iss": s.jwt_issuer, "aud": s.jwt_audience,
               "iat": now, "exp": now + timedelta(minutes=s.access_token_minutes)}
    return jwt.encode(payload, s.jwt_secret, algorithm=ALGORITHM)


def new_refresh_token() -> tuple[str, str]:
    """Devuelve (token en claro para el cliente, hash para la BD)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def require_user(request: Request) -> CurrentUser:
    """Usuario del token Bearer (se guarda en `request.state`); sin token válido, 401."""
    cached = request.state.get(USER_KEY)
    if isinstance(cached, CurrentUser):
        return cached
    scheme, _, token = request.header("Authorization").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPError(401, "No autenticado", UNAUTHORIZED)
    s = get_settings()
    try:
        p = jwt.decode(token, s.jwt_secret, algorithms=[ALGORITHM],
                       audience=s.jwt_audience, issuer=s.jwt_issuer,
                       options={"require": ["exp", "sub", "iss", "aud"]})
        user = CurrentUser(id=uuid.UUID(p["sub"]), roles=tuple(p.get("roles", [])))
    except (jwt.PyJWTError, ValueError):
        raise HTTPError(401, "No autenticado", UNAUTHORIZED) from None
    request.state[USER_KEY] = user
    return user


def require_role(request: Request, role: str) -> CurrentUser:
    """Uso: `user = require_role(request, "admin")`; incluye `require_user`."""
    user = require_user(request)
    if role not in user.roles:
        raise HTTPError(403, "Sin permiso")
    return user
```

`require_user` solo valida el token: no consulta la base, así que una cuenta desactivada sigue entrando hasta que vence su access token (15 min). Las rutas que no toleran esa ventana comprueban `is_active` con `get_db(request).get(User, user.id)` antes de seguir, y responden 401 si la cuenta ya no está activa.

## Módulo `src/modules/auth/` (se crea con `pynative-scaffold auth` y se delega por roles)

**models.py** (data-writer): `User` y `RefreshToken`.

```python
class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)   # guardado en minúsculas
    password_hash: Mapped[str] = mapped_column(String(255))
    roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user: Mapped[User] = relationship()
```

**schemas.py** (data-writer):

- `RegisterIn(email: EmailStr, password: str = Field(min_length=12, max_length=128))` con `extra="forbid"`.
- `LoginIn(email: EmailStr, password: str = Field(max_length=128))`: el tope evita que argon2 tenga que hashear entradas gigantes (DoS); no pongas `min_length`, para no revelar la política en el login.
- `TokenPair(access_token, refresh_token, token_type="bearer")`.
- `RefreshIn(refresh_token: str = Field(max_length=200))`.
- `UserRead(id, email, roles)`.

**services.py** (logic-writer): la parte delicada. No depende de la capa HTTP.

```python
def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.lower()))
    # El hash se verifica SIEMPRE (contra DUMMY_HASH si no hay usuario) antes de decidir:
    # el tiempo no revela si el email existe ni si la cuenta está desactivada.
    password_ok = verify_password(password, user.password_hash if user is not None else DUMMY_HASH)
    if user is None or not user.is_active or not password_ok:
        raise InvalidCredentials()
    return user


def issue_tokens(db: Session, user: User, family_id: uuid.UUID | None = None) -> tuple[str, str]:
    raw, hashed = new_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=hashed, family_id=family_id or uuid.uuid4(),
                        expires_at=datetime.now(UTC) + timedelta(days=get_settings().refresh_token_days)))
    db.commit()
    return create_access_token(user.id, user.roles), raw


def _as_utc(value: datetime) -> datetime:
    """SQLite y MySQL devuelven `DateTime(timezone=True)` sin zona: se interpreta como UTC."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _revoke(db: Session, *where: ColumnElement[bool], now: datetime) -> None:
    db.execute(update(RefreshToken).where(*where, RefreshToken.revoked_at.is_(None)).values(revoked_at=now))
    db.commit()


def rotate(db: Session, raw: str) -> tuple[str, str]:
    now = datetime.now(UTC)
    token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    if token is None or _as_utc(token.expires_at) <= now:
        raise InvalidCredentials()
    # Revocación atómica y condicional: de dos refresh concurrentes con el mismo token,
    # solo uno cambia la fila (rowcount == 1); el otro ve 0 filas y cuenta como reutilización.
    claimed = db.execute(update(RefreshToken).where(RefreshToken.id == token.id,
                                                    RefreshToken.revoked_at.is_(None))
                         .values(revoked_at=now)).rowcount
    if claimed != 1:
        # Reutilización: posible robo de ese token → revoca su familia (la sesión de ese dispositivo).
        _revoke(db, RefreshToken.family_id == token.family_id, now=now)
        raise InvalidCredentials()
    user = token.user
    if not user.is_active:                              # cuenta desactivada: no se renueva nada
        _revoke(db, RefreshToken.user_id == user.id, now=now)
        raise InvalidCredentials()
    return issue_tokens(db, user, family_id=token.family_id)   # su commit confirma también la revocación


def logout(db: Session, raw: str) -> None:
    _revoke(db, RefreshToken.token_hash == hash_token(raw), now=datetime.now(UTC))
```

**routes.py** (web-writer), `router = Router("/auth")`:

| Método y ruta | Comportamiento |
|---|---|
| `POST /register` | 201 → `UserRead`. Si el email existe, también 201 genérico o 409, según la ADR (enumeración). |
| `POST /login` | 200 → `TokenPair`. `InvalidCredentials` → `raise HTTPError(401, "Credenciales inválidas")`. |
| `POST /refresh` | 200 → `TokenPair`. |
| `POST /logout` | 204 (`return no_content()`). |
| `GET /me` | `user = require_user(request)` → `UserRead` del usuario `user.id`. |

Si el cliente es un navegador, entrega el refresh en una cookie, no en el JSON. Sin framework, la cabecera se arma con `http.cookies.SimpleCookie` de la stdlib: `httponly`, `secure` (solo si `app_env == "prod"`), `samesite="Lax"` y `path="/auth"`, y va en `response.headers["Set-Cookie"]`.

**Rate limit** en `/auth/login` y `/auth/refresh`: en el proxy inverso (nginx, Caddy, Traefik) o con un contador propio en Redis (`REDIS_URL`, que entrega el overlay de Redis; el cliente `redis` se agrega con aprobación). Documenta cuál usaste en `docs/AUTH.md`. La clave es la IP de la conexión (`request.remote_addr`); detrás de un proxy, toma de `X-Forwarded-For` solo la entrada que agregó tu proxy de confianza (la última), nunca la cabecera tal cual llega. Además del límite por IP, limita por cuenta (email normalizado con `strip().lower()`); ten en cuenta que eso permite bloquear a propósito el login de otra persona: usa un límite por cuenta más alto que el de IP, o pide un captcha o segundo factor tras N fallos.

## Fixtures de auth en `conftest.py` (orquestador)

```python
@pytest.fixture
def user(db: Session) -> User:
    u = User(email="ana@example.com", password_hash=hash_password("correct horse battery"), roles=[])
    db.add(u)
    db.commit()
    return u


@pytest.fixture
def auth_as(client: TestClient) -> Callable[[User], None]:
    def _auth(u: User) -> None:
        client.headers["Authorization"] = f"Bearer {create_access_token(u.id, u.roles)}"
    return _auth
```

Los tests corren con `JWT_SECRET` de `.env` dentro del contenedor; fuera de él, exporta uno de prueba (32+ caracteres) antes de llamar a pytest.

## Tests obligatorios (qa-writer)

- Login con credenciales incorrectas → 401, con el mismo mensaje para usuario inexistente y para cuenta desactivada.
- Token con `alg` distinto, expirado o con `aud` incorrecto → 401.
- Refresh rotado y reutilizado → 401, y el refresh nuevo de esa familia también queda revocado.
- Refresh de un usuario desactivado → 401.
- Logout → ese refresh ya no sirve.
