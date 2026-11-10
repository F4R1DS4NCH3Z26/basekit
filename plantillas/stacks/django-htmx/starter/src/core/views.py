"""Portada (orquestador). Las páginas de cada app viven en src/modules/<m>/views.py."""

from django.http import HttpRequest, HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_safe


@require_safe
def home(request: HttpRequest) -> HttpResponse:
    return render(request, "home.html")
