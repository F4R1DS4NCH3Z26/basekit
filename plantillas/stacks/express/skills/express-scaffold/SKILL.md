---
name: express-scaffold
description: Crea la estructura de un módulo nuevo de una API Express (src/modules/<modulo>/ con schemas, repository, errors, services y router), su carpeta de tests y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo en un proyecto Express, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/express-scaffold/scripts/scaffold.sh:*)
---

# express-scaffold

Genera el boilerplate con un script para que ningún agente gaste tokens escribiéndolo.

```bash
bash .agents/skills/express-scaffold/scripts/scaffold.sh <modulo>   # kebab-case: products, user-profiles
```

Crea `src/modules/<modulo>/` (`schemas.ts`, `repository.ts`, `errors.ts`, `services.ts`, `router.ts`), `tests/modules/<modulo>/` y `docs/specs/<modulo>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada: si el módulo existe, falla.

Lee `DB_DRIVER` de `compose.db.yaml`, igual que `app-setup.sh`. Con MongoDB (`mongodb`) agrega `model.ts` (modelo Mongoose con `_id` UUID en texto, colección `<modulo>`, `timestamps`) y el contrato trae la tabla del modelo Mongoose en vez de la de Prisma. Con una BD SQL o sin BD, todo sigue igual (Prisma).

`assets/package.json.tpl` es el `package.json` inicial que usa `make new-app`; no lo edites para un módulo.

`scripts/app-setup.sh` lo ejecuta `make new-app`: si existe `compose.db.yaml`, instala Prisma 7 (`PRISMA_VERSION`, exacta) con el adaptador de esa BD y crea `prisma/schema.prisma`, `prisma.config.ts` y `src/lib/db.ts`. Si activas la BD después, ejecútalo dentro de `make sh`: `bash .agents/skills/express-scaffold/scripts/app-setup.sh`. No sobrescribe archivos existentes. Con MongoDB instala `mongoose` (`MONGOOSE_VERSION`, exacta) en vez de Prisma, crea `src/mongo/connection.ts` (`MONGO_URL`) y `src/mongo/sync-indexes.ts`, y cambia `src/server.ts` para conectar antes de escuchar, solo si `src/server.ts` sigue siendo el del kit: si lo cambiaste, se detiene sin tocar ni instalar nada y dice qué agregar.

Después del scaffold:
1. Llena el contrato con el usuario: firmas y tablas, no prosa. Márcalo `Estado: cerrado`.
2. Orquestador: agrega el modelo a `prisma/schema.prisma`, `make migration NAME=<cambio>` (crea el SQL y regenera el cliente) y revisa el SQL antes de `make migrate`. Con MongoDB no hay migraciones: el data-writer escribe el modelo y sus índices en `model.ts`; en dev la app los crea al conectar y `make migrate` los crea en prod (nunca borra uno).
3. Orquestador: registra el router en `src/app.ts` (el script imprime la línea).
4. Sigue el flujo de AGENTS.md (zone-check --snapshot → data-writer → logic-writer → web-writer → qa-writer).
