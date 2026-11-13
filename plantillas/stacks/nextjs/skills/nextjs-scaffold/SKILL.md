---
name: nextjs-scaffold
description: Crea la estructura de una feature nueva de Next.js (src/features/<feature>/ con schemas, services, actions, server, index) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar una feature, entidad o módulo nuevo en un proyecto Next.js, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/nextjs-scaffold/scripts/scaffold.sh:*)
---

# nextjs-scaffold

Genera el boilerplate con un script para que ningún agente gaste tokens escribiéndolo.

```bash
bash .agents/skills/nextjs-scaffold/scripts/scaffold.sh <feature>   # kebab-case: products, user-profile
```

Crea `src/features/<feature>/` (`schemas.ts`, `services.ts`, `actions.ts`, `server.ts`, `index.ts`, `components/`), `tests/features/<feature>/` y `docs/specs/<feature>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada: si la feature existe, falla.

Lee `DB_DRIVER` de `compose.db.yaml`, igual que `app-setup.sh`. Con MongoDB (`mongodb`) agrega `model.ts` (modelo Mongoose con `_id` UUID en texto, colección `<feature>`, `timestamps`, `overwriteModels: true` para la recarga de `next dev`) y el contrato trae la tabla del modelo Mongoose en vez de la línea de entidad / tabla. Con una BD SQL o sin BD, todo sigue igual.

`scripts/app-setup.sh` no es para features: lo ejecuta `make new-app` solo con MongoDB. Instala `mongoose` (`MONGOOSE_VERSION`) y `tsx` (`TSX_VERSION`, desarrollo; lo usa `make migrate`) en versión exacta y crea `src/lib/db.ts` (`connectDb()` con `MONGO_URL`, una conexión por proceso), `src/lib/sync-indexes.ts` y `src/instrumentation.ts` (conecta al arrancar el servidor). No sobrescribe nada: si ya tienes `src/instrumentation.ts`, lo conserva y avisa qué agregar. Si activas MongoDB después de `make new-app`, ejecútalo dentro de `make sh`.

Después del scaffold:
1. Llena el contrato con el usuario. Cada sección `## <agente>` es lo único que leerá ese agente: escribe firmas y tablas, no prosa.
2. Cambia `Estado: borrador` a `Estado: cerrado` antes de delegar.
   Con MongoDB no hay migraciones: el data-writer escribe el modelo y sus índices en `model.ts`; en dev la app los crea al conectar y `make migrate` los crea en prod (nunca borra uno).
3. Sigue el flujo de AGENTS.md (zone-check --snapshot → data-writer → …).
