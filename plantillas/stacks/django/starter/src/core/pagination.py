"""Paginación por defecto de DRF: ?limit=&offset=, con tope de 100 por página."""

from rest_framework.pagination import LimitOffsetPagination


class DefaultPagination(LimitOffsetPagination):
    default_limit = 20
    max_limit = 100
