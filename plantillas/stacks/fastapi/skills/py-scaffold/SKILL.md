---
name: py-scaffold
description: Crea la estructura de un módulo nuevo de backend Python (src/modules/<modulo>/ con models, schemas, exceptions, services, router y tests) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo en FastAPI, Flask o Django, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/py-scaffold/scripts/scaffold.sh:*)
---

# py-scaffold

```bash
bash .agents/skills/py-scaffold/scripts/scaffold.sh <modulo>   # snake_case: orders, user_profiles
```

Crea `src/modules/<modulo>/` con archivos que solo tienen docstring (no asume framework), `tests/__init__.py` y `docs/specs/<modulo>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada.

Con MongoDB (`compose.db.yaml` con `DB_DRIVER: mongodb`), `models.py` ya trae un `Document` de Beanie con `id` UUID en texto y el contrato describe la colección en vez de la tabla SQL. `scripts/mongo-setup.sh` cambia el esqueleto de SQLAlchemy + Alembic a Beanie: lo corre `make new-app` antes de `uv lock` y no hace nada con otra BD.

Después del scaffold:
1. Llena el contrato con el usuario: firmas y tablas, no prosa. Márcalo `Estado: cerrado`.
2. Registra el router en `src/main.py` (el script imprime la línea). Es tarea del orquestador.
3. Sigue el flujo de AGENTS.md. Tras el data-writer, genera la migración (Alembic `revision --autogenerate` o `makemigrations`) y pide confirmación antes de aplicarla. Con MongoDB no hay migraciones: los índices se declaran en el modelo y `make migrate` los crea (nunca borra uno).
