# Auth en FastAPI: JWT de acceso + refresh rotado

Dependencias (con aprobación del usuario):

```bash
make deps-add PKGS="sqlalchemy>=2 psycopg[binary] alembic pyjwt>=2.9 pwdlib[argon2]"
```

Para MySQL, cambia `psycopg[binary]` por `pymysql`. Después, inicializa Alembic una vez: `make sh` y, dentro, `alembic init alembic`. Configura `alembic/env.py` para usar `get_settings().database_url` y `Base.metadata`.

## `src/core/config.py`: agrega a `Settings` (orquestador)

```python
    jwt_secret: str
    jwt_issuer: str = "app"
    jwt_audience: str = "app-clients"
    access_token_minutes: int = 15
    refresh_token_days: int = 14
```

## `src/core/db.py` (orquestador)

```python
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.core.config import get_settings


class Base(DeclarativeBase):
    pass


_url = get_settings().database_url
if not _url:
    raise RuntimeError("DATABASE_URL no está configurada (skill infra-setup)")
engine = create_engine(_url, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
```

## `src/core/security.py` (orquestador)

```python
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

from src.core.config import get_settings

ALGORITHM = "HS256"                       # fijo: nunca se lee del token
_hasher = PasswordHash.recommended()      # argon2id
DUMMY_HASH = _hasher.hash("timing-equalizer")
_bearer = HTTPBearer(auto_error=False)


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


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CurrentUser:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "No autenticado",
                                 headers={"WWW-Authenticate": "Bearer"})
    if creds is None:
        raise unauthorized
    s = get_settings()
    try:
        p = jwt.decode(creds.credentials, s.jwt_secret, algorithms=[ALGORITHM],
                       audience=s.jwt_audience, issuer=s.jwt_issuer,
                       options={"require": ["exp", "sub", "iss", "aud"]})
    except jwt.PyJWTError:
        raise unauthorized from None
    return CurrentUser(id=uuid.UUID(p["sub"]), roles=tuple(p.get("roles", [])))


def require_role(role: str):  # uso: Depends(require_role("admin"))
    def _dep(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        if role not in user.roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Sin permiso")
        return user
    return _dep
```

## Módulo `src/modules/auth/` (se crea con `py-scaffold auth` y se delega por roles)

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
- `LoginIn`.
- `TokenPair(access_token, refresh_token, token_type="bearer")`.
- `RefreshIn(refresh_token: str = Field(max_length=200))`.
- `UserRead(id, email, roles)`.

**services.py** (logic-writer): la parte delicada.

```python
def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        verify_password(password, DUMMY_HASH)          # mismo tiempo exista o no el usuario
        raise InvalidCredentials()
    if not user.is_active or not verify_password(password, user.password_hash):
        raise InvalidCredentials()
    return user


def issue_tokens(db: Session, user: User, family_id: uuid.UUID | None = None) -> tuple[str, str]:
    raw, hashed = new_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=hashed, family_id=family_id or uuid.uuid4(),
                        expires_at=datetime.now(UTC) + timedelta(days=get_settings().refresh_token_days)))
    db.commit()
    return create_access_token(user.id, user.roles), raw


def rotate(db: Session, raw: str) -> tuple[str, str]:
    token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    now = datetime.now(UTC)
    if token is None or token.expires_at < now:
        raise InvalidCredentials()
    if token.revoked_at is not None:                    # reutilización: posible robo → revoca la familia
        db.execute(update(RefreshToken).where(RefreshToken.family_id == token.family_id,
                                              RefreshToken.revoked_at.is_(None)).values(revoked_at=now))
        db.commit()
        raise InvalidCredentials()
    token.revoked_at = now
    return issue_tokens(db, token.user, family_id=token.family_id)


def logout(db: Session, raw: str) -> None:
    db.execute(update(RefreshToken).where(RefreshToken.token_hash == hash_token(raw),
                                          RefreshToken.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
    db.commit()
```

**router.py** (web-writer), prefijo `/auth`:

| Método y ruta | Comportamiento |
|---|---|
| `POST /register` | 201 → `UserRead`. Si el email existe, también 201 genérico o 409, según la ADR (enumeración). |
| `POST /login` | 200 → `TokenPair`. `InvalidCredentials` → 401 "Credenciales inválidas". |
| `POST /refresh` | 200 → `TokenPair`. |
| `POST /logout` | 204. |
| `GET /me` | `Depends(get_current_user)` → `UserRead`. |

Si el cliente es un navegador, entrega el refresh en una cookie `httponly=True, secure=(app_env=="prod"), samesite="lax", path="/auth"`, no en el JSON.

**Rate limit** en `/auth/login` y `/auth/refresh`: con `slowapi` (requiere aprobación), o en el proxy inverso. Documenta cuál usaste en `docs/AUTH.md`.

## Tests obligatorios (qa-writer)

- Login con credenciales incorrectas → 401, con el mismo mensaje para usuario inexistente.
- Token con `alg` distinto, expirado o con `aud` incorrecto → 401.
- Refresh rotado y reutilizado → 401, y el refresh nuevo de esa familia también queda revocado.
- Logout → ese refresh ya no sirve.
