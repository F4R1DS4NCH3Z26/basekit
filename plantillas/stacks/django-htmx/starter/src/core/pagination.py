"""Paginación de listados: ?page=N, 20 por página y tope de 100.

Las plantillas piden la página siguiente con hx-get (djhtmx-patterns).
"""

from django.core.paginator import Page, Paginator
from django.db.models import Model, QuerySet
from django.http import HttpRequest

PER_PAGE = 20
MAX_PER_PAGE = 100


def paginate[M: Model](
    request: HttpRequest, queryset: QuerySet[M], per_page: int = PER_PAGE
) -> Page[M]:
    """La página pedida en ?page=; un valor inválido o fuera de rango da la primera o la última."""
    paginator = Paginator(queryset, max(1, min(per_page, MAX_PER_PAGE)))
    return paginator.get_page(request.GET.get("page"))
