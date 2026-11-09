---
name: pynative-patterns
description: "Código de referencia seguro para un módulo de la API Python nativa (WSGI de la stdlib, sin framework): modelo SQLAlchemy 2, schemas Pydantic v2, excepciones de dominio, service sin HTTP, router propio con auth y salida serializada por schema, y tests con pytest y el TestClient de src/core/testing.py. Úsala SIEMPRE antes de escribir models, schemas, services, routes o tests de un módulo."
---

# pynative-patterns

Ejemplo con el módulo `products`. Copia la forma y cambia los nombres. Busca con Grep lo que ya existe en `src/core/` (`Base`, `get_db`, `Router`, `HTTPError`, `json_response`, `require_user`) antes de asumir sus nombres. Auth: `references/auth.md`.

Sin framework: la capa HTTP es de la stdlib y vive en `src/core/` (zona del orquestador). No agregues Flask, FastAPI, Django ni Starlette.

| Pieza | Archivo | Qué hace |
|---|---|---|
| `Request` | `src/core/http.py` | `request.json()` (vacío → None, 415 si no es JSON, 400 si está roto), `request.query`, `request.header(...)`, cuerpo máximo 1 MiB (413) |
| `json_response`, `no_content`, `HTTPError` | `src/core/http.py` | `json_response(data, 201)`; `raise HTTPError(404)` → `{"error": …}` |
| `Router` | `src/core/router.py` | `@router.get("/{id:uuid}")`; convertidores `str`, `int`, `uuid` (valor inválido → 404); 405 con `Allow` |
| `App` | `src/core/wsgi.py` | `ValidationError` → 422 sin eco de la entrada, 500 sin trazas, CORS con orígenes explícitos, OPTIONS, HEAD |
| `get_db(request)`, `load_models()` | `src/core/db.py` | Una sesión por petición que se cierra sola; `create_app()` importa todos los `models.py` (las FK entre módulos resuelven aunque el router de un módulo no esté incluido) |

## models.py — data-writer

```python
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

## schemas.py — data-writer

```python
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProductCreate(BaseModel):
    # extra="forbid": un cliente no puede colar owner_id, role, is_admin… (mass assignment)
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)
    price: Decimal = Field(gt=0, max_digits=10, decimal_places=2)


class ProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    price: Decimal


class PageQuery(BaseModel):
    """Query string de los listados: `?limit=20&offset=0`."""
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
```

## exceptions.py y services.py — logic-writer

```python
# exceptions.py
class ProductError(Exception): ...
class ProductNotFound(ProductError): ...
class ProductForbidden(ProductError): ...
```

```python
# services.py — sin imports de src.core.http ni src.core.router
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .exceptions import ProductForbidden, ProductNotFound
from .models import Product
from .schemas import ProductCreate

MAX_PAGE = 100


def create_product(db: Session, data: ProductCreate, owner_id: UUID) -> Product:
    product = Product(**data.model_dump(), owner_id=owner_id)  # owner_id viene del usuario autenticado
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def get_product(db: Session, product_id: UUID, user_id: UUID) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise ProductNotFound(product_id)
    if product.owner_id != user_id:
        raise ProductForbidden(product_id)
    return product


def list_products(db: Session, owner_id: UUID, limit: int = 20, offset: int = 0) -> list[Product]:
    stmt = (
        select(Product)
        .where(Product.owner_id == owner_id)          # parámetros enlazados, nunca f-strings
        .order_by(Product.created_at.desc())
        .limit(min(limit, MAX_PAGE))
        .offset(max(offset, 0))
    )
    return list(db.scalars(stmt))
```

## routes.py — web-writer

```python
from uuid import UUID

from src.core.db import get_db
from src.core.http import HTTPError, Request, Response, json_response
from src.core.router import Router
from src.core.security import require_user

from . import services
from .exceptions import ProductForbidden, ProductNotFound
from .models import Product
from .schemas import PageQuery, ProductCreate, ProductRead

router = Router("/products")


def _out(product: Product) -> dict[str, object]:
    # La salida siempre pasa por el schema de lectura: nunca se serializa el modelo ORM.
    return ProductRead.model_validate(product).model_dump(mode="json")


@router.post("")
def create_product(request: Request) -> Response:
    user = require_user(request)  # primero la auth: sin token es 401, aunque el cuerpo sea inválido
    # ValidationError (campo extra, tipo inválido) → 422, lo traduce src/core/wsgi.py
    data = ProductCreate.model_validate(request.json() or {})
    product = services.create_product(get_db(request), data, owner_id=user.id)
    return json_response(_out(product), 201)


@router.get("")
def list_products(request: Request) -> Response:
    user = require_user(request)
    page = PageQuery.model_validate(request.query)
    items = services.list_products(get_db(request), user.id, page.limit, page.offset)
    return json_response([_out(p) for p in items])


@router.get("/{product_id:uuid}")
def get_product(request: Request, product_id: UUID) -> Response:
    user = require_user(request)
    try:
        product = services.get_product(get_db(request), product_id, user.id)
    except (ProductNotFound, ProductForbidden):
        raise HTTPError(404) from None  # 404 también para recursos ajenos: no revela que existen
    return json_response(_out(product))
```

El orquestador lo incluye en `create_app()`: `from src.modules.products.routes import router as products_router` y `router.include(products_router)`.

## Tests — qa-writer (`src/modules/products/tests/test_routes.py`)

Los fixtures viven en `conftest.py` de la raíz (zona del orquestador): `app`, `client` (`TestClient` de `src/core/testing.py` sobre SQLite en memoria), `db` y, cuando exista auth, `user` y `auth_as(user)` (ver `references/auth.md`). mypy es strict también en los tests: anota fixtures y retornos.

```python
from collections.abc import Callable
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from src.core.security import hash_password
from src.core.testing import TestClient
from src.modules.auth.models import User
from src.modules.products.models import Product

AuthAs = Callable[[User], None]


@pytest.fixture
def other_user_product(db: Session) -> Product:
    """Fixture del módulo: vive en el archivo de test (zona del qa-writer), no en conftest.py."""
    other = User(email="otro@example.com", password_hash=hash_password("otra clave larga"), roles=[])
    db.add(other)
    db.flush()
    product = Product(name="Ajeno", price=Decimal("2.00"), owner_id=other.id)
    db.add(product)
    db.commit()
    return product


def test_create_requires_auth(client: TestClient) -> None:
    assert client.post("/products", json={"name": "A", "price": "1.00"}).status_code == 401


def test_create_rejects_extra_fields(client: TestClient, auth_as: AuthAs, user: User) -> None:
    auth_as(user)
    r = client.post("/products", json={"name": "A", "price": "1.00", "owner_id": "x"})
    assert r.status_code == 422


def test_other_users_product_is_404(
    client: TestClient, auth_as: AuthAs, user: User, other_user_product: Product
) -> None:
    auth_as(user)
    assert client.get(f"/products/{other_user_product.id}").status_code == 404


def test_create_ok(client: TestClient, auth_as: AuthAs, user: User) -> None:
    auth_as(user)
    r = client.post("/products", json={"name": "A", "price": "1.00"})
    assert r.status_code == 201
    assert set(r.json()) == {"id", "name", "price"}  # no filtra campos internos
```

## Reglas que no cambian

- SQL solo con el ORM o `text(":param")`; nunca f-strings.
- La sesión sale de `get_db(request)` en routes y se pasa a services; services nunca recibe `Request`.
- El usuario sale de `require_user(request)`, nunca del cuerpo de la petición.
- Prohibidos sobre datos de entrada: `eval`, `pickle.loads`, `yaml.load`, `string.Template` o `str.format` con plantillas del cliente y `subprocess` con `shell=True`.
- Sin `wsgiref.simple_server` en prod: sirve gunicorn (el Dockerfile ya lo hace).
