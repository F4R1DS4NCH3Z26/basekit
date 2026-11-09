---
name: djhtmx-scaffold
description: Crea la estructura de una app nueva de Django + HTMX (src/modules/<modulo>/ con models, admin, exceptions, services, forms, views, urls, templates/<modulo>/, apps, migrations y tests) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o pantalla nueva, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/djhtmx-scaffold/scripts/scaffold.sh:*)
---

# djhtmx-scaffold

```bash
bash .agents/skills/djhtmx-scaffold/scripts/scaffold.sh <modulo>   # snake_case: orders, user_profiles
```

Crea `src/modules/<modulo>/` (archivos con docstring; `apps.py` con su `AppConfig` y `urls.py` con `urlpatterns` vacío), `templates/<modulo>/` (vacía), `migrations/__init__.py`, `tests/__init__.py` y `docs/specs/<modulo>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada.

Después del scaffold:
1. Llena el contrato con el usuario: firmas y tablas (pantallas, parciales, swaps out-of-band), no prosa. Márcalo `Estado: cerrado`.
2. Registra la app en `INSTALLED_APPS` y sus urls en `src/config/urls.py` (el script imprime las líneas). Es tarea del orquestador.
3. Sigue el flujo de AGENTS.md: data-writer → logic-writer → views-writer → qa-writer. Tras el data-writer, genera la migración (`make migration NAME=create_<modulo>`) y pide confirmación antes de aplicarla (`make migrate`).
