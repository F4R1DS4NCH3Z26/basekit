---
name: py-patterns
description: Código de referencia seguro para un módulo de backend Python - modelo SQLAlchemy 2 (o Document de Beanie si la BD es MongoDB), schemas Pydantic v2, excepciones de dominio, service sin HTTP, router FastAPI con auth y response_model, y tests con pytest. Incluye equivalencias para Django y Flask. Úsala SIEMPRE antes de escribir models, schemas, services, routers o tests de un módulo Python.
---

# py-patterns

**¿SQLAlchemy o Beanie?** Si existe `src/core/create_indexes.py` (BD MongoDB), el modelo, los services, el router y los tests son los de [Variante MongoDB](#variante-mongodb-beanie); schemas y excepciones no cambian.

Ejemplo con el módulo `products`. Copia la forma y cambia los nombres. Busca con Grep lo que ya existe en `src/core/` (`Base`, `get_db`, `load_models` en `db.py`; `get_current_user` cuando exista auth) antes de asumir sus nombres. Una FK a la tabla de otro módulo (`ForeignKey("users.id")`) funciona porque `load_models()` importa todos los `models.py` antes de usar el ORM.

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

Los fixtures viven en `conftest.py` de la raíz (zona del orquestador), para que los vean `tests/` y `src/modules/*/tests/`: `app`, `client` (TestClient con BD SQLite en memoria vía `app.dependency_overrides[get_db]`), `db` y, cuando exista auth, `user` y `auth_as(user)` (ver `references/auth.md`). mypy es strict también en los tests: anota fixtures y retornos.

```python
from collections.abc import Callable

from fastapi.testclient import TestClient

from src.modules.auth.models import User
from src.modules.products.models import Product

AuthAs = Callable[[User], None]


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

## Variante MongoDB (Beanie)

Con MongoDB no hay SQLAlchemy ni Alembic: `src/core/db.py` inicializa Beanie en el lifespan con todos los `Document` de `src/modules/*/models.py` (no hay `get_db` ni sesión). El `_id` es un UUID en texto, así el contrato y el `id: UUID` de `ProductRead` no cambian.

```python
# models.py — data-writer
from datetime import UTC, datetime
from uuid import uuid4

from beanie import DecimalAnnotation, Document
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class Product(Document):
    id: str = Field(default_factory=lambda: str(uuid4()))  # type: ignore[assignment]
    name: str = Field(max_length=120)
    price: DecimalAnnotation  # Decimal se guarda como Decimal128: sin la anotación, leerlo falla
    owner_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "products"
        indexes = [IndexModel([("owner_id", ASCENDING), ("created_at", DESCENDING)])]
```

```python
# services.py — logic-writer: async y sin sesión; filtros con campos del modelo
from .exceptions import ProductForbidden, ProductNotFound
from .models import Product
from .schemas import ProductCreate

MAX_PAGE = 100


async def create_product(data: ProductCreate, owner_id: str) -> Product:
    product = Product(**data.model_dump(), owner_id=owner_id)  # owner_id viene del usuario autenticado
    await product.insert()
    return product


async def get_product(product_id: str, user_id: str) -> Product:
    product = await Product.get(product_id)
    if product is None:
        raise ProductNotFound(product_id)
    if product.owner_id != user_id:
        raise ProductForbidden(product_id)
    return product


async def list_products(owner_id: str, limit: int = 20, offset: int = 0) -> list[Product]:
    return (
        await Product.find(Product.owner_id == owner_id)  # nunca un dict armado con input del cliente
        .sort("-created_at")
        .skip(max(offset, 0))
        .limit(min(limit, MAX_PAGE))
        .to_list()
    )
```

```python
# router.py — web-writer: endpoints async, sin DB; los ids van como texto a los services
@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(data: ProductCreate, user: User) -> Product:
    return await services.create_product(data, owner_id=str(user.id))


@router.get("/{product_id}", response_model=ProductRead)
async def get_product(product_id: UUID, user: User) -> Product:
    try:
        return await services.get_product(str(product_id), str(user.id))
    except (ProductNotFound, ProductForbidden):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No encontrado") from None
```

Tests: los fixtures del `conftest.py` de la raíz usan una MongoDB en memoria (mongomock), nueva en cada test, sin red ni BD real: `client` igual que con SQL y `db` (la base de datos, con Beanie ya inicializado) para probar services, que son async:

```python
from typing import Any

import pytest
from pymongo.asynchronous.database import AsyncDatabase

from src.modules.products import services
from src.modules.products.exceptions import ProductForbidden
from src.modules.products.schemas import ProductCreate


@pytest.mark.anyio
async def test_get_other_users_product_is_forbidden(db: AsyncDatabase[Any]) -> None:
    p = await services.create_product(ProductCreate(name="A", price="1.00"), owner_id="u1")
    with pytest.raises(ProductForbidden):
        await services.get_product(p.id, "u2")
```

Índices: en dev se crean al arrancar la app; en prod no, los crea `make migrate ENV=prod` (`src/core/create_indexes.py`). Ninguno de los dos borra: quitar un índice del modelo no lo quita de la BD. Bórralo a mano en `make db-shell` (`ENV=prod` en producción): `db.products.getIndexes()` para ver su nombre y `db.products.dropIndex('<nombre>')`. Cambiar las opciones de un índice que ya existe (por ejemplo `unique`) hace fallar el arranque y `make migrate`: bórralo a mano primero. `make migration` no aplica: no hay migraciones.

Auth con MongoDB: `references/auth.md` no cambia en tokens, `CurrentUser` ni endpoints; `User` y `RefreshToken` son `Document` de Beanie y las funciones que reciben `db: Session` pasan a ser `async` sin sesión, como los services de arriba.

## Equivalencias por framework

| Pieza | FastAPI | Flask | Django (+ DRF) |
|---|---|---|---|
| models.py | SQLAlchemy 2 | SQLAlchemy 2 / Flask-SQLAlchemy | Django ORM |
| schemas.py | Pydantic v2 | Pydantic v2 o Marshmallow (`unknown = RAISE`) | `serializers.py` con `fields` explícitos, nunca `"__all__"` |
| services.py | igual | igual | igual (reciben objetos, no `request`) |
| router.py | `APIRouter` | `Blueprint` | `views.py` + `urls.py` con `permission_classes` |
| Auth | `Depends(get_current_user)` | decorador `login_required` | `IsAuthenticated` + filtrar `queryset` por usuario |
