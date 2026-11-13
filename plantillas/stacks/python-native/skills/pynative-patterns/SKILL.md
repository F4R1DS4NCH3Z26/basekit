---
name: pynative-patterns
description: "Código de referencia seguro para un módulo de la API Python nativa (WSGI de la stdlib, sin framework): modelo SQLAlchemy 2 (o colección PyMongo si la BD es MongoDB), schemas Pydantic v2, excepciones de dominio, service sin HTTP, router propio con auth y salida serializada por schema, y tests con pytest y el TestClient de src/core/testing.py. Úsala SIEMPRE antes de escribir models, schemas, services, routes o tests de un módulo."
---

# pynative-patterns

**¿SQLAlchemy o PyMongo?** Si existe `src/core/create_indexes.py` (BD MongoDB), el modelo, los schemas de lectura, los services y los tests son los de [Variante MongoDB](#variante-mongodb-pymongo); excepciones y la forma de las routes no cambian.

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

## Variante MongoDB (PyMongo)

Con MongoDB no hay SQLAlchemy ni Alembic. `src/core/db.py` crea el cliente de `MONGO_URL` en el primer uso (no al importar) y `get_db(request)` devuelve la base de datos (`Database`), no una sesión. Cada `models.py` declara su colección (`COLLECTION`), sus índices (`INDEXES`) y el tipo del documento; el `_id` es un UUID en texto, así el contrato no cambia.

```python
# models.py — data-writer
from datetime import datetime
from typing import Any, TypedDict

from bson.decimal128 import Decimal128
from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.collection import Collection
from pymongo.database import Database

COLLECTION = "products"
INDEXES: list[IndexModel] = [IndexModel([("owner_id", ASCENDING), ("created_at", DESCENDING)])]


class ProductDocument(TypedDict):
    _id: str
    name: str
    price: Decimal128  # PyMongo no guarda Decimal: Decimal128 (exacto); el schema lo convierte al leer
    owner_id: str
    created_at: datetime


def collection(db: Database[Any]) -> Collection[ProductDocument]:
    return db[COLLECTION]
```

```python
# schemas.py — data-writer: la entrada no cambia; la lectura toma `_id` y convierte Decimal128
from decimal import Decimal

from bson.decimal128 import Decimal128
from pydantic import BaseModel, Field, field_validator


class ProductRead(BaseModel):
    id: str = Field(validation_alias="_id")
    name: str
    price: Decimal

    @field_validator("price", mode="before")
    @classmethod
    def _decimal128(cls, v: object) -> object:
        return v.to_decimal() if isinstance(v, Decimal128) else v
```

```python
# services.py — logic-writer: reciben la base de datos; filtros armados aquí, nunca un dict del cliente
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from bson.decimal128 import Decimal128
from pymongo.database import Database

from .exceptions import ProductForbidden, ProductNotFound
from .models import ProductDocument, collection
from .schemas import ProductCreate

MAX_PAGE = 100


def create_product(db: Database[Any], data: ProductCreate, owner_id: str) -> ProductDocument:
    doc: ProductDocument = {
        "_id": str(uuid4()),
        "name": data.name,
        "price": Decimal128(data.price),
        "owner_id": owner_id,  # viene del usuario autenticado
        "created_at": datetime.now(UTC),
    }
    collection(db).insert_one(doc)
    return doc


def get_product(db: Database[Any], product_id: str, user_id: str) -> ProductDocument:
    product = collection(db).find_one({"_id": product_id})
    if product is None:
        raise ProductNotFound(product_id)
    if product["owner_id"] != user_id:
        raise ProductForbidden(product_id)
    return product


def list_products(
    db: Database[Any], owner_id: str, limit: int = 20, offset: int = 0
) -> list[ProductDocument]:
    cursor = (
        collection(db)
        .find({"owner_id": owner_id})  # valores validados, nunca un dict armado con input del cliente
        .sort("created_at", -1)
        .skip(max(offset, 0))
        .limit(min(limit, MAX_PAGE))
    )
    return list(cursor)
```

Routes: iguales que arriba, con dos cambios. `_out()` recibe el documento (`ProductRead.model_validate(product)`), y los ids van como texto a los services: `services.get_product(get_db(request), str(product_id), user.id)`.

Tests: los fixtures del `conftest.py` de la raíz usan una MongoDB en memoria (mongomock), nueva en cada test y con los índices declarados ya creados, sin red ni BD real: `client` igual que con SQL y `db` (la base de datos) para probar services:

```python
from typing import Any

import pytest
from pymongo.database import Database

from src.modules.products import services
from src.modules.products.exceptions import ProductForbidden
from src.modules.products.schemas import ProductCreate


def test_get_other_users_product_is_forbidden(db: Database[Any]) -> None:
    p = services.create_product(db, ProductCreate(name="A", price="1.00"), owner_id="u1")
    with pytest.raises(ProductForbidden):
        services.get_product(db, p["_id"], "u2")
```

Índices: en dev se crean en el primer uso de la BD (la primera petición que llama a `get_db(request)`); en prod no, los crea `make migrate ENV=prod` (`src/core/create_indexes.py`). Ninguno de los dos borra: quitar un índice de `INDEXES` no lo quita de la BD. Bórralo a mano en `make db-shell` (`ENV=prod` en producción): `db.products.getIndexes()` para ver su nombre y `db.products.dropIndex('<nombre>')`. Cambiar las opciones de un índice que ya existe (por ejemplo `unique`) hace fallar `make migrate` y, en dev, el primer uso de la BD: bórralo a mano primero. `make migration` no aplica: no hay migraciones.

Auth con MongoDB: `references/auth.md` no cambia en tokens, `require_user` ni endpoints; `User` y `RefreshToken` son colecciones con su `TypedDict` y las funciones que reciben `db: Session` reciben la base de datos y usan `find_one`, `insert_one` y `update_one`/`update_many` con filtros como los de arriba.

## Reglas que no cambian

- SQL solo con el ORM o `text(":param")`; nunca f-strings. MongoDB: filtros con valores ya validados; nunca un dict del cliente dentro de un filtro (inyección NoSQL con `$ne`, `$gt`…) ni `$where`.
- La sesión sale de `get_db(request)` en routes y se pasa a services; services nunca recibe `Request`.
- El usuario sale de `require_user(request)`, nunca del cuerpo de la petición.
- Prohibidos sobre datos de entrada: `eval`, `pickle.loads`, `yaml.load`, `string.Template` o `str.format` con plantillas del cliente y `subprocess` con `shell=True`.
- Sin `wsgiref.simple_server` en prod: sirve gunicorn (el Dockerfile ya lo hace).
