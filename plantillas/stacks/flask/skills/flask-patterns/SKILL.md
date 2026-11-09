---
name: flask-patterns
description: Código de referencia seguro para un módulo de la API Flask - modelo SQLAlchemy 2, schemas Pydantic v2, excepciones de dominio, service sin Flask, Blueprint con auth y salida serializada por schema, y tests con pytest y el test client. Úsala SIEMPRE antes de escribir models, schemas, services, routes o tests de un módulo.
---

# flask-patterns

Ejemplo con el módulo `products`. Copia la forma y cambia los nombres. Busca con Grep lo que ya existe en `src/core/` (`Base`, `get_db`, `login_required`) antes de asumir sus nombres. Auth: `references/auth.md`.

Lo que ya resuelve el esqueleto (`src/main.py`, zona del orquestador): `ValidationError` de Pydantic → 422 en JSON sin eco de la entrada, cualquier `HTTPException` (`abort(404)`) → JSON `{"error": …}`, 500 sin trazas, CORS con orígenes explícitos y cuerpo máximo de 1 MiB.

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
# services.py — sin imports de Flask ni Werkzeug
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

from flask import Blueprint, Response, abort, g, jsonify, request

from src.core.db import get_db
from src.core.security import login_required

from . import services
from .exceptions import ProductForbidden, ProductNotFound
from .models import Product
from .schemas import PageQuery, ProductCreate, ProductRead

bp = Blueprint("products", __name__, url_prefix="/products")


def _out(product: Product) -> dict[str, object]:
    # La salida siempre pasa por el schema de lectura: nunca se serializa el modelo ORM.
    return ProductRead.model_validate(product).model_dump(mode="json")


@bp.post("")
@login_required
def create_product() -> tuple[Response, int]:
    # ValidationError (campo extra, tipo inválido) → 422, lo traduce src/main.py
    data = ProductCreate.model_validate(request.get_json(silent=True) or {})
    product = services.create_product(get_db(), data, owner_id=g.user.id)
    return jsonify(_out(product)), 201


@bp.get("")
@login_required
def list_products() -> tuple[Response, int]:
    page = PageQuery.model_validate(request.args.to_dict())
    items = services.list_products(get_db(), g.user.id, page.limit, page.offset)
    return jsonify([_out(p) for p in items]), 200


@bp.get("/<uuid:product_id>")
@login_required
def get_product(product_id: UUID) -> tuple[Response, int]:
    try:
        product = services.get_product(get_db(), product_id, g.user.id)
    except (ProductNotFound, ProductForbidden):
        abort(404)  # 404 también para recursos ajenos: no revela que existen
    return jsonify(_out(product)), 200
```

El orquestador lo registra en `create_app()`: `from src.modules.products.routes import bp as products_bp` y `app.register_blueprint(products_bp)`.

## Tests — qa-writer (`src/modules/products/tests/test_routes.py`)

Los fixtures viven en `conftest.py` de la raíz (zona del orquestador): `app`, `client` (test client sobre SQLite en memoria), `db` y, cuando exista auth, `user` y `auth_as(user)` (ver `references/auth.md`). mypy es strict también en los tests: anota fixtures y retornos.

```python
from collections.abc import Callable

from flask.testing import FlaskClient

from src.modules.auth.models import User
from src.modules.products.models import Product

AuthAs = Callable[[User], None]


def test_create_requires_auth(client: FlaskClient) -> None:
    assert client.post("/products", json={"name": "A", "price": "1.00"}).status_code == 401


def test_create_rejects_extra_fields(client: FlaskClient, auth_as: AuthAs, user: User) -> None:
    auth_as(user)
    r = client.post("/products", json={"name": "A", "price": "1.00", "owner_id": "x"})
    assert r.status_code == 422


def test_other_users_product_is_404(
    client: FlaskClient, auth_as: AuthAs, user: User, other_user_product: Product
) -> None:
    auth_as(user)
    assert client.get(f"/products/{other_user_product.id}").status_code == 404


def test_create_ok(client: FlaskClient, auth_as: AuthAs, user: User) -> None:
    auth_as(user)
    r = client.post("/products", json={"name": "A", "price": "1.00"})
    assert r.status_code == 201
    assert set(r.get_json()) == {"id", "name", "price"}  # no filtra campos internos
```

## Reglas que no cambian

- SQL solo con el ORM o `text(":param")`; nunca f-strings.
- La sesión sale de `get_db()` en routes y se pasa a services; nunca `flask.g` dentro de services.
- Prohibidos sobre datos de entrada: `eval`, `pickle.loads`, `yaml.load`, `render_template_string` y `subprocess` con `shell=True`.
- Sin `app.run(debug=True)`: el depurador de Werkzeug ejecuta código arbitrario.
