---
name: django-patterns
description: Código de referencia seguro para una app de Django + Django REST Framework - modelo del ORM, serializers con campos explícitos, admin, excepciones de dominio, service sin HTTP, vistas DRF con permisos y queryset por usuario, urls y tests con pytest-django. Úsala SIEMPRE antes de escribir models, serializers, admin, services, views o tests de un módulo Django.
---

# django-patterns

Ejemplo con la app `products` (`src/modules/products/`, creada con `django-scaffold`). Copia la forma y cambia los nombres. Busca con Grep lo que ya existe en `src/core/` y `src/config/` antes de asumir nombres. El usuario es siempre `settings.AUTH_USER_MODEL` (nunca importes `User` directamente en un modelo).

## models.py — data-writer

```python
import uuid

from django.conf import settings
from django.db import models


class Product(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)  # no enumerable
    name = models.CharField(max_length=120)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    # ForeignKey ya crea su índice
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="products"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name
```

## serializers.py — data-writer

```python
from decimal import Decimal

from rest_framework import serializers

from .models import Product


class ProductCreateSerializer(serializers.ModelSerializer[Product]):
    # Campos explícitos: un cliente no puede colar owner, id o is_staff (mass assignment).
    price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))

    class Meta:
        model = Product
        fields = ["name", "price"]


class ProductReadSerializer(serializers.ModelSerializer[Product]):
    class Meta:
        model = Product
        fields = ["id", "name", "price", "created_at"]
        read_only_fields = fields
```

Nunca `fields = "__all__"` ni `exclude`: un campo nuevo del modelo quedaría expuesto (o escribible) sin que nadie lo decida.

## admin.py — data-writer

```python
from django.contrib import admin

from .models import Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin[Product]):
    list_display = ["name", "price", "owner", "created_at"]
    search_fields = ["name"]
    list_select_related = ["owner"]
    readonly_fields = ["id", "created_at"]
```

## exceptions.py y services.py — logic-writer

```python
# exceptions.py
class ProductError(Exception): ...


class ProductNotFound(ProductError): ...
```

```python
# services.py — sin rest_framework ni django.http; reciben objetos, no request
import uuid
from typing import Any

from django.contrib.auth.models import User  # con usuario propio: src.modules.accounts.models
from django.db import transaction
from django.db.models import QuerySet

from .exceptions import ProductNotFound
from .models import Product

MAX_PAGE = 100


def products_of(owner: User) -> QuerySet[Product]:
    return Product.objects.filter(owner=owner)  # ORM: parámetros enlazados, nunca f-strings


@transaction.atomic
def create_product(*, owner: User, data: dict[str, Any]) -> Product:
    return Product.objects.create(owner=owner, **data)  # owner viene del usuario autenticado


def get_product(*, owner: User, product_id: uuid.UUID) -> Product:
    try:
        return products_of(owner).get(pk=product_id)  # recurso ajeno = no existe
    except Product.DoesNotExist:
        raise ProductNotFound(product_id) from None
```

## views.py, permissions.py y urls.py — web-writer

```python
# views.py
from typing import Any

from django.db.models import QuerySet
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response

from . import services
from .models import Product
from .serializers import ProductCreateSerializer, ProductReadSerializer


class ProductListCreate(generics.ListAPIView[Product]):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ProductReadSerializer  # paginación global: ?limit= (máx. 100) y ?offset=

    def get_queryset(self) -> QuerySet[Product]:
        return services.products_of(self.request.user)  # type: ignore[arg-type]

    def post(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        data = ProductCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)  # 400 con el detalle por campo
        product = services.create_product(owner=request.user, data=data.validated_data)  # type: ignore[arg-type]
        return Response(ProductReadSerializer(product).data, status=status.HTTP_201_CREATED)


class ProductDetail(generics.RetrieveAPIView[Product]):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ProductReadSerializer

    def get_queryset(self) -> QuerySet[Product]:
        return services.products_of(self.request.user)  # type: ignore[arg-type]  # ajeno → 404
```

```python
# urls.py
from django.urls import URLPattern, URLResolver, path

from . import views

app_name = "products"
urlpatterns: list[URLPattern | URLResolver] = [
    path("", views.ProductListCreate.as_view(), name="list"),
    path("<uuid:pk>/", views.ProductDetail.as_view(), name="detail"),
]
```

Un permiso propio (`permissions.py`) hereda de `BasePermission` y decide en `has_object_permission`; aun así, el `get_queryset` filtrado por dueño es la primera barrera.

Registro (orquestador): `"src.modules.products.apps.ProductsConfig"` en `INSTALLED_APPS` y `path("api/products/", include("src.modules.products.urls"))` en `src/config/urls.py`.

## Tests — qa-writer (`src/modules/products/tests/test_views.py`)

Fixtures de `conftest.py` en la raíz (orquestador): `api_client`, `user`, `other_user`, `auth_as(user)`. La BD de tests es SQLite en memoria (`settings_test.py`).

```python
from collections.abc import Callable
from typing import Any

import pytest
from rest_framework.test import APIClient

from src.modules.products.models import Product

URL = "/api/products/"
AuthAs = Callable[[Any], None]


@pytest.mark.django_db
def test_create_requires_auth(api_client: APIClient) -> None:
    r = api_client.post(URL, {"name": "A", "price": "1.00"}, format="json")
    assert r.status_code in (401, 403)


def test_create_ignores_owner(
    api_client: APIClient, auth_as: AuthAs, user: Any, other_user: Any
) -> None:
    auth_as(user)
    data = {"name": "A", "price": "1.00", "owner": str(other_user.pk)}
    r = api_client.post(URL, data, format="json")
    assert r.status_code == 201
    assert Product.objects.get(pk=r.json()["id"]).owner == user


def test_other_users_product_is_404(
    api_client: APIClient, auth_as: AuthAs, user: Any, other_user: Any
) -> None:
    product = Product.objects.create(name="B", price="2.00", owner=other_user)
    auth_as(user)
    assert api_client.get(f"{URL}{product.pk}/").status_code == 404


def test_create_ok(api_client: APIClient, auth_as: AuthAs, user: Any) -> None:
    auth_as(user)
    r = api_client.post(URL, {"name": "A", "price": "1.00"}, format="json")
    assert r.status_code == 201
    assert set(r.json()) == {"id", "name", "price", "created_at"}  # no filtra campos internos
```

## Seguridad que no se negocia

- Sin `raw()`, `extra()` ni `cursor.execute` con f-strings; si hace falta SQL, `cursor.execute(sql, [params])`.
- Sin `mark_safe` ni `|safe` sobre datos del usuario; sin `csrf_exempt` en vistas con sesión.
- `DEBUG`, `ALLOWED_HOSTS` y cookies seguras los fija `src/config/settings.py` desde el entorno: no los cambies en una app.
- Auth con JWT (SimpleJWT): `references/auth.md`.
