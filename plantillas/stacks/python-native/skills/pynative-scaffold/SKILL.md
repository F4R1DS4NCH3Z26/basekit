---
name: pynative-scaffold
description: Crea la estructura de un módulo nuevo de la API Python nativa sobre WSGI (src/modules/<modulo>/ con models, schemas, exceptions, services, routes y tests) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/pynative-scaffold/scripts/scaffold.sh:*)
---

# pynative-scaffold

```bash
bash .agents/skills/pynative-scaffold/scripts/scaffold.sh <modulo>   # snake_case: orders, user_profiles
```

Crea `src/modules/<modulo>/` con archivos que solo tienen docstring, `tests/__init__.py` y `docs/specs/<modulo>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada.

Después del scaffold:
1. Llena el contrato con el usuario: firmas y tablas, no prosa. Márcalo `Estado: cerrado`.
2. Incluye el router del módulo en `create_app()` de `src/main.py` (el script imprime la línea). Es tarea del orquestador.
3. Sigue el flujo de AGENTS.md. Tras el data-writer, genera la migración (`make migration NAME=<modulo>`; `alembic/env.py` importa solo los `models.py` de cada módulo) y pide confirmación antes de aplicarla (`make migrate`).
