---
name: flask-scaffold
description: Crea la estructura de un módulo nuevo de la API Flask (src/modules/<modulo>/ con models, schemas, exceptions, services, routes y tests) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/flask-scaffold/scripts/scaffold.sh:*)
---

# flask-scaffold

```bash
bash .agents/skills/flask-scaffold/scripts/scaffold.sh <modulo>   # snake_case: orders, user_profiles
```

Crea `src/modules/<modulo>/` con archivos que solo tienen docstring, `tests/__init__.py` y `docs/specs/<modulo>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada.

Con MongoDB (`compose.db.yaml` con `DB_DRIVER: mongodb`), `models.py` ya trae `COLLECTION`, `INDEXES`, el `TypedDict` `<Pascal>Document` con `_id` UUID en texto y `collection(db)`, y el contrato describe la colección en vez de la tabla SQL. `scripts/mongo-setup.sh` cambia el esqueleto de SQLAlchemy + Alembic a PyMongo: lo corre `make new-app` antes de `uv lock`, no hace nada con otra BD y nunca sobrescribe un archivo que cambiaste (si alguno ya no es el del esqueleto, se detiene sin tocar nada y dice cuáles).

Después del scaffold:
1. Llena el contrato con el usuario: firmas y tablas, no prosa. Márcalo `Estado: cerrado`.
2. Registra el Blueprint en `create_app()` de `src/main.py` (el script imprime la línea). Es tarea del orquestador.
3. Sigue el flujo de AGENTS.md. Tras el data-writer, genera la migración (`make migration NAME=<modulo>`; `alembic/env.py` importa solo los `models.py` de cada módulo) y pide confirmación antes de aplicarla (`make migrate`). Con MongoDB no hay migraciones: los índices se declaran en `INDEXES` y `make migrate` los crea (nunca borra uno).
