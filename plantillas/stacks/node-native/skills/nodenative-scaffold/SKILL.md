---
name: nodenative-scaffold
description: "Crea la estructura de un módulo nuevo de una API en Node nativo (node:http, sin framework): src/modules/<modulo>/ con schemas, repository, errors, services y router, su carpeta de tests y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo en este proyecto, antes de escribir código o contrato a mano."
allowed-tools: Bash(bash .agents/skills/nodenative-scaffold/scripts/scaffold.sh:*)
---

# nodenative-scaffold

Genera el boilerplate con un script para que ningún agente gaste tokens escribiéndolo.

```bash
bash .agents/skills/nodenative-scaffold/scripts/scaffold.sh <modulo>   # kebab-case: products, user-profiles
```

Crea `src/modules/<modulo>/` (`schemas.ts`, `repository.ts`, `errors.ts`, `services.ts`, `router.ts` con un `new Router()` de `src/lib/router.ts`), `tests/modules/<modulo>/` y `docs/specs/<modulo>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada: si el módulo existe, falla.

`assets/package.json.tpl` es el `package.json` inicial que usa `make new-app`; no lo edites para un módulo.

`scripts/app-setup.sh` lo ejecuta `make new-app`: si existe `compose.db.yaml`, instala Prisma 7 (`PRISMA_VERSION`, exacta) con el adaptador de esa BD y crea `prisma/schema.prisma`, `prisma.config.ts` y `src/lib/db.ts`. Si activas la BD después, ejecútalo dentro de `make sh`: `bash .agents/skills/nodenative-scaffold/scripts/app-setup.sh`. No sobrescribe archivos existentes.

Después del scaffold:
1. Llena el contrato con el usuario: firmas y tablas, no prosa. Márcalo `Estado: cerrado`.
2. Orquestador: agrega el modelo a `prisma/schema.prisma`, `make migration NAME=<cambio>` (crea el SQL y regenera el cliente) y revisa el SQL antes de `make migrate`.
3. Orquestador: monta el router en `src/app.ts` con `router.mount("/<modulo>", <modulo>Router)` (el script imprime la línea).
4. Sigue el flujo de AGENTS.md (zone-check --snapshot → data-writer → logic-writer → web-writer → qa-writer).
