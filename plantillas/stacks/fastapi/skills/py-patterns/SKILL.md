---
name: py-patterns
description: Código de referencia seguro para un módulo de backend Python - modelo SQLAlchemy 2, schemas Pydantic v2, excepciones de dominio, service sin HTTP, router FastAPI con auth y response_model, y tests con pytest. Incluye equivalencias para Django y Flask. Úsala SIEMPRE antes de escribir models, schemas, services, routers o tests de un módulo Python.
---

# py-patterns

Ejemplo con el módulo `products`. Copia la forma y cambia los nombres. Busca con Grep lo que ya existe en `src/core/` (`Base`, `get_db`, `get_current_user`) antes de asumir sus nombres.

## models.py — data-writer

```python
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
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
```

## exceptions.py y services.py — logic-writer

```python
# exceptions.py
class ProductError(Exception): ...
class ProductNotFound(ProductError): ...
class ProductForbidden(ProductError): ...
```

```python
# services.py — sin imports de FastAPI/HTTP
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

Variante async: `AsyncSession`, `await db.execute(stmt)`, `(await db.scalars(stmt)).all()`.

## router.py — web-writer

```python
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from src.core.db import get_db
from src.core.security import CurrentUser, get_current_user

from . import services
from .exceptions import ProductForbidden, ProductNotFound
from .models import Product
from .schemas import ProductCreate, ProductRead

router = APIRouter(prefix="/products", tags=["products"])
DB = Annotated[Session, Depends(get_db)]
User = Annotated[CurrentUser, Depends(get_current_user)]


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(data: ProductCreate, db: DB, user: User) -> Product:
    return services.create_product(db, data, owner_id=user.id)


@router.get("", response_model=list[ProductRead])
def list_products(
    db: DB, user: User,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Product]:
    return services.list_products(db, user.id, limit, offset)


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: UUID, db: DB, user: User) -> Product:
    try:
        return services.get_product(db, product_id, user.id)
    except (ProductNotFound, ProductForbidden):
        # 404 también para recursos ajenos: no revela que existen
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No encontrado") from None
```

## Tests — qa-writer (`src/modules/products/tests/test_router.py`)

Los fixtures viven en `tests/conftest.py` (zona del orquestador): `client` (TestClient con BD de pruebas vía `app.dependency_overrides[get_db]`) y `auth_as(user)` (sobrescribe `get_current_user`).

```python
def test_create_requires_auth(client):
    assert client.post("/products", json={"name": "A", "price": "1.00"}).status_code == 401


def test_create_rejects_extra_fields(client, auth_as, user):
    auth_as(user)
    r = client.post("/products", json={"name": "A", "price": "1.00", "owner_id": "x"})
    assert r.status_code == 422


def test_other_users_product_is_404(client, auth_as, user, other_user_product):
    auth_as(user)
    assert client.get(f"/products/{other_user_product.id}").status_code == 404


def test_create_ok(client, auth_as, user):
    auth_as(user)
    r = client.post("/products", json={"name": "A", "price": "1.00"})
    assert r.status_code == 201
    assert set(r.json()) == {"id", "name", "price"}  # no filtra campos internos
```

## Equivalencias por framework

| Pieza | FastAPI | Flask | Django (+ DRF) |
|---|---|---|---|
| models.py | SQLAlchemy 2 | SQLAlchemy 2 / Flask-SQLAlchemy | Django ORM |
| schemas.py | Pydantic v2 | Pydantic v2 o Marshmallow (`unknown = RAISE`) | `serializers.py` con `fields` explícitos, nunca `"__all__"` |
| services.py | igual | igual | igual (reciben objetos, no `request`) |
| router.py | `APIRouter` | `Blueprint` | `views.py` + `urls.py` con `permission_classes` |
| Auth | `Depends(get_current_user)` | decorador `login_required` | `IsAuthenticated` + filtrar `queryset` por usuario |
