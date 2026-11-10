---
name: djhtmx-patterns
description: "Código de referencia seguro para una app Django + HTMX (plantillas del servidor) - modelo del ORM, admin, service sin HTTP, formulario con campos explícitos, vistas que responden página completa o parcial con request.htmx, CRUD en línea con validación 422, CSRF con hx-headers, swaps out-of-band, paginación con hx-get y tests con pytest-django. Úsala SIEMPRE antes de escribir models, admin, services, forms, views, urls, plantillas o tests de un módulo."
---

# djhtmx-patterns

Ejemplo con la app `products` (`src/modules/products/`, creada con `djhtmx-scaffold`): un CRUD completo con lista paginada, alta y edición en línea, borrado y contador actualizado out-of-band. Copia la forma y cambia los nombres. Busca con Grep lo que ya existe en `src/core/`, `templates/` y `static/css/` antes de asumir nombres. El usuario es siempre `settings.AUTH_USER_MODEL` en los modelos.

Lo que ya trae el proyecto (orquestador; úsalo, no lo copies):

| Pieza | Dónde | Para qué |
|---|---|---|
| `AuthedHtmxRequest` | `src/core/htmx.py` | Tipo de `request` en vistas con `@login_required` (`request.htmx`, `request.user`) |
| `render_page(request, página, parcial, contexto, status)` | `src/core/htmx.py` | Página completa sin HTMX; solo el parcial con `HX-Request` (no en un *history restore*). Añade `Vary: HX-Request` |
| `wants_partial(request)` | `src/core/htmx.py` | La misma decisión, para respuestas que no son "página o parcial" |
| `HtmxLoginRedirectMiddleware` | `src/core/htmx.py` | Petición HTMX sin sesión → `HX-Redirect` al login (no pega el login dentro del fragmento) |
| `paginate(request, queryset)` | `src/core/pagination.py` | `?page=N`, 20 por página, tope 100; página inválida → primera o última |
| `base.html` | `templates/` | htmx fijado con SRI, `htmx-config` (sin eval, 422 se intercambia) y `hx-headers` con el token CSRF en `<body>` |

## models.py y admin.py — data-writer

```python
# models.py
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
        ordering = ["-created_at"]  # la paginación necesita un orden estable

    def __str__(self) -> str:
        return self.name
```

```python
# admin.py
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
# services.py
"""Casos de uso de products: sin request, sin formularios, sin HTML."""

import uuid
from decimal import Decimal

from django.contrib.auth.models import User  # con usuario propio: src.modules.accounts.models
from django.db import transaction
from django.db.models import QuerySet

from .exceptions import ProductNotFound
from .models import Product


def products_of(owner: User) -> QuerySet[Product]:
    return Product.objects.filter(owner=owner)  # ORM: parámetros enlazados, nunca f-strings


def get_product(*, owner: User, product_id: uuid.UUID) -> Product:
    try:
        return products_of(owner).get(pk=product_id)  # recurso ajeno = no existe
    except Product.DoesNotExist:
        raise ProductNotFound(product_id) from None


@transaction.atomic
def create_product(*, owner: User, name: str, price: Decimal) -> Product:
    return Product.objects.create(owner=owner, name=name, price=price)  # owner = la sesión


@transaction.atomic
def update_product(*, owner: User, product_id: uuid.UUID, name: str, price: Decimal) -> Product:
    product = get_product(owner=owner, product_id=product_id)
    product.name, product.price = name, price
    product.save(update_fields=["name", "price"])
    return product


@transaction.atomic
def delete_product(*, owner: User, product_id: uuid.UUID) -> None:
    get_product(owner=owner, product_id=product_id).delete()
```

## forms.py, views.py y urls.py — views-writer

```python
# forms.py
from decimal import Decimal

from django import forms


class ProductForm(forms.Form):
    # Campos explícitos: owner, id o is_staff nunca son campos del formulario (mass assignment).
    name = forms.CharField(label="Nombre", max_length=120)
    price = forms.DecimalField(
        label="Precio", max_digits=10, decimal_places=2, min_value=Decimal("0.01")
    )
```

Nunca `ModelForm` con `fields = "__all__"` ni `exclude`, y nunca `form.save()` en la vista: el formulario valida y `services.py` escribe.

```python
# views.py
import uuid
from typing import Any

from django.contrib.auth.decorators import login_required
from django.http import Http404, HttpResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from src.core.htmx import AuthedHtmxRequest, render_page, wants_partial
from src.core.pagination import paginate

from . import services
from .exceptions import ProductNotFound
from .forms import ProductForm
from .models import Product


def _own_product(request: AuthedHtmxRequest, pk: uuid.UUID) -> Product:
    try:
        return services.get_product(owner=request.user, product_id=pk)
    except ProductNotFound:
        raise Http404 from None  # producto ajeno → 404, no 403: no revela que existe


def _list_context(request: AuthedHtmxRequest) -> dict[str, Any]:
    page = paginate(request, services.products_of(request.user))  # ?page=N, 20 por página
    return {"page": page, "count": page.paginator.count}


@login_required
@require_GET
def product_list(request: AuthedHtmxRequest) -> HttpResponse:
    return render_page(request, "products/list.html", "products/_list.html", _list_context(request))


@login_required
@require_http_methods(["GET", "POST"])
def product_create(request: AuthedHtmxRequest) -> HttpResponse:
    form = ProductForm(request.POST if request.method == "POST" else None)
    if request.method == "POST":
        if not form.is_valid():  # mismo parcial con los errores; 422 (htmx-config lo intercambia)
            context = {**_list_context(request), "form": form}
            return render_page(
                request, "products/list.html", "products/_create_form.html", context, status=422
            )
        services.create_product(
            owner=request.user, name=form.cleaned_data["name"], price=form.cleaned_data["price"]
        )
        if not wants_partial(request):
            return redirect("products:list")  # sin JS: POST → redirect → GET
        # The form area goes back to its button; the count and the list update out-of-band.
        return render(request, "products/_created.html", _list_context(request))
    # Without HTMX the list page opens with the form already shown.
    context = {**_list_context(request), "form": form}
    return render_page(request, "products/list.html", "products/_create_form.html", context)


@login_required
@require_http_methods(["GET", "POST"])
def product_edit(request: AuthedHtmxRequest, pk: uuid.UUID) -> HttpResponse:
    product = _own_product(request, pk)
    status = 200
    if request.method == "POST":
        form = ProductForm(request.POST)
        if form.is_valid():
            product = services.update_product(
                owner=request.user,
                product_id=pk,
                name=form.cleaned_data["name"],
                price=form.cleaned_data["price"],
            )
            if not wants_partial(request):
                return redirect("products:list")
            return render(request, "products/_item.html", {"product": product})
        status = 422
    else:
        form = ProductForm(initial={"name": product.name, "price": product.price})
    context = {"form": form, "product": product}
    return render_page(
        request, "products/edit.html", "products/_edit_form.html", context, status=status
    )


@login_required
@require_GET
def product_item(request: AuthedHtmxRequest, pk: uuid.UUID) -> HttpResponse:
    """The "Cancelar" button of the inline editor: the item again, read-only."""
    product = _own_product(request, pk)
    if not wants_partial(request):
        return redirect("products:list")
    return render(request, "products/_item.html", {"product": product})


@login_required
@require_POST
def product_delete(request: AuthedHtmxRequest, pk: uuid.UUID) -> HttpResponse:
    try:
        services.delete_product(owner=request.user, product_id=pk)
    except ProductNotFound:
        raise Http404 from None
    if not wants_partial(request):
        return redirect("products:list")
    # The empty main swap removes the item (hx-swap="outerHTML"); the count goes out-of-band.
    count = services.products_of(request.user).count()
    return render(request, "products/_count.html", {"count": count, "oob": True})
```

```python
# urls.py
from django.urls import URLPattern, URLResolver, path

from . import views

app_name = "products"
urlpatterns: list[URLPattern | URLResolver] = [
    path("", views.product_list, name="list"),
    path("new/", views.product_create, name="create"),
    path("<uuid:pk>/", views.product_item, name="item"),
    path("<uuid:pk>/edit/", views.product_edit, name="edit"),
    path("<uuid:pk>/delete/", views.product_delete, name="delete"),
]
```

Registro (orquestador): `"src.modules.products.apps.ProductsConfig"` en `INSTALLED_APPS` y `path("products/", include("src.modules.products.urls"))` en `src/config/urls.py`.

## Plantillas — views-writer (`src/modules/products/templates/products/`)

Una página completa extiende `base.html` e incluye sus parciales; un parcial (`_x.html`) es lo que recibe HTMX. Así la misma URL sirve con y sin JavaScript.

| Plantilla | Tipo | La usa |
|---|---|---|
| `list.html` | página | `product_list`, `product_create` sin HTMX |
| `_list.html` | parcial (y OOB con `oob=True`) | lista + paginación con `hx-get` |
| `_item.html` | parcial | una fila; Editar (`hx-get`) y Borrar (`hx-post` + `hx-confirm`) |
| `_count.html` | parcial (y OOB) | contador |
| `_new_button.html` | parcial | abre el formulario en línea |
| `_create_form.html` | parcial | alta; con errores vuelve con 422 |
| `_created.html` | parcial | respuesta del alta: botón + contador y lista out-of-band |
| `edit.html` / `_edit_form.html` | página / parcial | edición en línea (`hx-target="this"`) |

```html
{# templates/products/list.html #}
{% extends "base.html" %}
{% block title %}Productos{% endblock %}
{% block content %}
  <h1>Productos</h1>
  {% include "products/_count.html" %}
  <div id="product-form">
    {% if form %}{% include "products/_create_form.html" %}{% else %}{% include "products/_new_button.html" %}{% endif %}
  </div>
  {% include "products/_list.html" %}
{% endblock %}
```

```html
{# templates/products/_list.html #}
<div id="product-list"{% if oob %} hx-swap-oob="true"{% endif %}>
  {% for product in page %}
    {% include "products/_item.html" %}
  {% empty %}
    <p>Todavía no hay productos.</p>
  {% endfor %}
  {% if page.has_other_pages %}
    <nav class="pager" aria-label="Paginación">
      {% if page.has_previous %}
        {% url 'products:list' as list_url %}
        <a href="{{ list_url }}?page={{ page.previous_page_number }}" hx-get="{{ list_url }}?page={{ page.previous_page_number }}"
           hx-target="#product-list" hx-swap="outerHTML" hx-push-url="true">Anterior</a>
      {% endif %}
      <span>Página {{ page.number }} de {{ page.paginator.num_pages }}</span>
      {% if page.has_next %}
        {% url 'products:list' as list_url %}
        <a href="{{ list_url }}?page={{ page.next_page_number }}" hx-get="{{ list_url }}?page={{ page.next_page_number }}"
           hx-target="#product-list" hx-swap="outerHTML" hx-push-url="true">Siguiente</a>
      {% endif %}
    </nav>
  {% endif %}
</div>
```

```html
{# templates/products/_item.html #}
<article id="product-{{ product.pk }}" class="item">
  <span>{{ product.name }}</span>
  <span>{{ product.price }}</span>
  <a href="{% url 'products:edit' product.pk %}" hx-get="{% url 'products:edit' product.pk %}"
     hx-target="#product-{{ product.pk }}" hx-swap="outerHTML">Editar</a>
  <form method="post" action="{% url 'products:delete' product.pk %}" hx-post="{% url 'products:delete' product.pk %}"
        hx-target="#product-{{ product.pk }}" hx-swap="outerHTML" hx-confirm="¿Borrar «{{ product.name }}»?">
    {% csrf_token %}
    <button type="submit">Borrar</button>
  </form>
</article>
```

```html
{# templates/products/_count.html #}
<p id="product-count"{% if oob %} hx-swap-oob="true"{% endif %}>{{ count }} producto{{ count|pluralize }}</p>
```

```html
{# templates/products/_new_button.html #}
<a href="{% url 'products:create' %}" hx-get="{% url 'products:create' %}" hx-target="#product-form">Nuevo producto</a>
```

```html
{# templates/products/_create_form.html #}
<form method="post" action="{% url 'products:create' %}" hx-post="{% url 'products:create' %}" hx-target="#product-form">
  {% csrf_token %}
  {{ form.as_div }}
  <button type="submit">Guardar</button>
</form>
```

```html
{# templates/products/_created.html #}
{% include "products/_new_button.html" %}
{% include "products/_count.html" with oob=True %}
{% include "products/_list.html" with oob=True %}
```

```html
{# templates/products/edit.html #}
{% extends "base.html" %}
{% block title %}Editar producto{% endblock %}
{% block content %}
  <h1>Editar producto</h1>
  {% include "products/_edit_form.html" %}
  <p><a href="{% url 'products:list' %}">Volver a la lista</a></p>
{% endblock %}
```

```html
{# templates/products/_edit_form.html #}
<form id="product-{{ product.pk }}" class="item" method="post" action="{% url 'products:edit' product.pk %}"
      hx-post="{% url 'products:edit' product.pk %}" hx-target="this" hx-swap="outerHTML">
  {% csrf_token %}
  {{ form.as_div }}
  <button type="submit">Guardar</button>
  <a href="{% url 'products:list' %}" hx-get="{% url 'products:item' product.pk %}"
     hx-target="#product-{{ product.pk }}" hx-swap="outerHTML">Cancelar</a>
</form>
```

Reglas de HTMX de este stack:
- **CSRF**: `{% csrf_token %}` en cada `<form>` (funciona sin JS) y el `hx-headers` de `<body>` en `base.html` lo envía en cada petición HTMX. Nunca `csrf_exempt`.
- **Validación**: los errores vuelven en el mismo parcial con status 422; `htmx-config` (en `base.html`) intercambia 422 y descarta los demás 4xx/5xx.
- **Out-of-band**: un elemento con `id` y `hx-swap-oob="true"` en la respuesta reemplaza al del mismo `id` en la página. Úsalo para lo que cambia fuera del objetivo (contador, lista). Las filas son `<article>`/`<div>`, no `<tr>`: un `<tr>` suelto en un OOB necesita `<template>`.
- **Paginación**: enlaces con `href` (sin JS) y `hx-get` + `hx-target` + `hx-push-url`. `render_page` devuelve la página entera en un *history restore*.
- **Sin JS en línea**: nada de `<script>`, `style=`, `onclick` ni `hx-on` (la CSP de prod solo permite `'self'` y htmx corre con `allowEval: false`). Estilos en `static/css/app.css`; si hace falta JS, un archivo en `static/js/`.

## Tests — qa-writer (`src/modules/products/tests/test_views.py`)

Fixtures de `conftest.py` en la raíz (orquestador): `client` (pytest-django), `csrf_client` (exige CSRF), `user`, `other_user`, `login_as(user)`. La BD de tests es SQLite en memoria (`settings_test.py`). Las cabeceras van con `headers=` (`{"HX-Request": "true"}`).

```python
# src/modules/products/tests/test_views.py
import re
from collections.abc import Callable
from typing import Any

import pytest
from django.test import Client

from src.modules.products.models import Product

URL = "/products/"
NEW = "/products/new/"
HX = {"HX-Request": "true"}
LoginAs = Callable[[Any], None]


@pytest.mark.django_db
def test_list_requires_login(client: Client) -> None:
    r = client.get(URL)
    assert r.status_code == 302
    assert r["Location"].startswith("/login/?next=")


@pytest.mark.django_db
def test_htmx_without_session_redirects_the_whole_page(client: Client) -> None:
    r = client.get(URL, headers=HX)
    assert r["HX-Redirect"].startswith("/login/?next=")  # not the login page inside a fragment


def test_full_page_without_htmx_and_partial_with_htmx(
    client: Client, login_as: LoginAs, user: Any
) -> None:
    Product.objects.create(name="Mesa", price="10.00", owner=user)
    login_as(user)
    full = client.get(URL)
    part = client.get(URL, headers=HX)
    assert full.status_code == part.status_code == 200
    assert b"<html" in full.content and b"hx-headers=" in full.content
    assert b"<html" not in part.content and b'id="product-list"' in part.content
    assert b"Mesa" in part.content
    assert "HX-Request" in part["Vary"]


def test_post_without_csrf_token_is_403(csrf_client: Client, user: Any) -> None:
    csrf_client.force_login(user)
    r = csrf_client.post(NEW, {"name": "A", "price": "1.00"}, headers=HX)
    assert r.status_code == 403
    assert not Product.objects.exists()


def test_post_with_the_hx_headers_token_is_accepted(csrf_client: Client, user: Any) -> None:
    csrf_client.force_login(user)
    page = csrf_client.get(URL).content.decode()
    match = re.search(r'"X-CSRFToken": "([^"]+)"', page)  # hx-headers of <body> in base.html
    assert match
    headers = {**HX, "X-CSRFToken": match.group(1)}
    r = csrf_client.post(NEW, {"name": "A", "price": "1.00"}, headers=headers)
    assert r.status_code == 200
    assert Product.objects.filter(owner=user).count() == 1


def test_invalid_data_rerenders_the_partial_with_errors(
    client: Client, login_as: LoginAs, user: Any
) -> None:
    login_as(user)
    r = client.post(NEW, {"name": "", "price": "0"}, headers=HX)
    assert r.status_code == 422
    assert b"<html" not in r.content and b"<form" in r.content
    assert b"errorlist" in r.content
    assert not Product.objects.exists()


def test_create_updates_count_and_list_out_of_band(
    client: Client, login_as: LoginAs, user: Any, other_user: Any
) -> None:
    login_as(user)
    data = {"name": "Silla", "price": "5.00", "owner": str(other_user.pk)}
    r = client.post(NEW, data, headers=HX)
    assert r.status_code == 200
    assert r.content.count(b'hx-swap-oob="true"') == 2  # #product-count and #product-list
    assert b"1 producto<" in r.content and b"Silla" in r.content
    assert Product.objects.get().owner == user  # owner comes from the session, never the form


def test_create_without_htmx_redirects(client: Client, login_as: LoginAs, user: Any) -> None:
    login_as(user)
    r = client.post(NEW, {"name": "Silla", "price": "5.00"})
    assert r.status_code == 302 and r["Location"] == URL


def test_edit_inline(client: Client, login_as: LoginAs, user: Any) -> None:
    product = Product.objects.create(name="Mesa", price="10.00", owner=user)
    login_as(user)
    url = f"{URL}{product.pk}/edit/"
    assert b'hx-target="this"' in client.get(url, headers=HX).content
    bad = client.post(url, {"name": "Mesa", "price": "-1"}, headers=HX)
    assert bad.status_code == 422 and b"errorlist" in bad.content
    ok = client.post(url, {"name": "Mesa grande", "price": "12.00"}, headers=HX)
    assert ok.status_code == 200 and b'class="item"' in ok.content
    product.refresh_from_db()
    assert product.name == "Mesa grande"


def test_other_users_product_is_404(
    client: Client, login_as: LoginAs, user: Any, other_user: Any
) -> None:
    product = Product.objects.create(name="B", price="2.00", owner=other_user)
    login_as(user)
    assert client.get(f"{URL}{product.pk}/edit/", headers=HX).status_code == 404
    assert client.post(f"{URL}{product.pk}/delete/", headers=HX).status_code == 404
    assert Product.objects.filter(pk=product.pk).exists()


def test_delete_returns_the_count_out_of_band(client: Client, login_as: LoginAs, user: Any) -> None:
    product = Product.objects.create(name="Mesa", price="10.00", owner=user)
    login_as(user)
    r = client.post(f"{URL}{product.pk}/delete/", headers=HX)
    assert r.status_code == 200
    assert b'id="product-count" hx-swap-oob="true"' in r.content
    assert not Product.objects.exists()


def test_pagination_with_hx_get(client: Client, login_as: LoginAs, user: Any) -> None:
    Product.objects.bulk_create(
        [Product(name=f"P{i:02}", price="1.00", owner=user) for i in range(25)]
    )
    login_as(user)
    r = client.get(f"{URL}?page=2", headers=HX)
    assert r.content.count(b'class="item"') == 5
    assert "Página 2 de 2".encode() in r.content
    assert b'hx-get="/products/?page=1"' in r.content


def test_user_data_is_escaped(client: Client, login_as: LoginAs, user: Any) -> None:
    Product.objects.create(name="<script>alert(1)</script>", price="1.00", owner=user)
    login_as(user)
    r = client.get(URL)
    assert b"<script>alert(1)</script>" not in r.content
    assert b"&lt;script&gt;alert(1)&lt;/script&gt;" in r.content
```

## Seguridad que no se negocia

- Autoescape siempre activo: nunca `|safe`, `|safeseq`, `{% autoescape off %}` ni `mark_safe`/`format_html` con datos del usuario sin escapar (`djhtmx-verify` y ruff `S308` lo marcan).
- Sin `raw()`, `extra()` ni `cursor.execute` con f-strings; si hace falta SQL, `cursor.execute(sql, [params])`.
- Toda vista con datos tiene `@login_required` y filtra por dueño en `services.py`; un recurso ajeno es 404.
- Métodos explícitos (`@require_GET`, `@require_POST`, `@require_http_methods`): nada que cambie datos con GET.
- `DEBUG`, `ALLOWED_HOSTS`, cookies seguras y la CSP los fija `src/config/settings.py` desde el entorno: no los cambies en una app.
- Login y logout con la sesión de Django: `references/auth.md`.
