---
name: infra-setup
description: Activa la base de datos (PostgreSQL, MySQL o SQLite) y/o Redis de un proyecto creado con basekit, agregando el overlay de Docker Compose, las variables a .env.example y el acceso con make db-shell. Úsala SIEMPRE después de decidir en el bootstrap (o en una ADR) qué persistencia necesita el proyecto, en lugar de editar compose a mano.
allowed-tools: Bash(bash .agents/skills/infra-setup/scripts/infra.sh:*)
---

# infra-setup

```bash
bash .agents/skills/infra-setup/scripts/infra.sh --db postgres            # o mysql | sqlite | none
bash .agents/skills/infra-setup/scripts/infra.sh --db postgres --redis    # + Redis
```

Qué hace:
- Copia el overlay a `compose.db.yaml` y, con `--redis`, a `compose.redis.yaml`. El `Makefile` incluye los overlays automáticamente si existen.
- Agrega a `.env.example` un bloque marcado (`# >>> db`) con secretos `__GENERATE__`, que `make env` reemplaza por valores aleatorios.
- Inyecta la conexión en el contenedor `app` en todos los formatos habituales, para que funcione en cualquier stack sin cambios:
  - `DATABASE_URL` (Prisma, Drizzle, SQLAlchemy).
  - `DB_HOST`, `DB_PORT`, `DB_DATABASE`… (Laravel).
  - `SPRING_DATASOURCE_*` (Spring).
- La base de datos **no publica puertos** al host. Para entrar, usa `make db-shell`.

Es idempotente y no reemplaza un overlay modificado a mano sin `--force`. Si `.env` ya existe, avisa qué variables agregar: nunca toca secretos.

Después:
1. `make env` (si no hay `.env`) → `make dev`.
2. Configura la conexión en la app según la skill `<stack>-patterns` (sección base de datos de su `references/auth.md` o del patrón de modelos).
3. Registra la decisión en una ADR (`docs/adr/NNNN-base-de-datos.md`) y en la tabla de `docs/PROJECT.md`.
