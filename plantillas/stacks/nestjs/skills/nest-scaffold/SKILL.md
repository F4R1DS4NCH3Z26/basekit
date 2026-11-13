---
name: nest-scaffold
description: "Crea la estructura de un módulo nuevo de API REST NestJS (src/modules/<modulo>/ con schemas, repository, errors, service, controller y module) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo en un proyecto NestJS, antes de escribir código o contrato a mano."
allowed-tools: Bash(bash .agents/skills/nest-scaffold/scripts/scaffold.sh:*)
---

# nest-scaffold

Genera el boilerplate con un script para que ningún agente gaste tokens escribiéndolo.

```bash
bash .agents/skills/nest-scaffold/scripts/scaffold.sh <modulo>   # kebab-case en plural: products, order-items
```

Crea `src/modules/<modulo>/` (`<modulo>.schemas.ts`, `.repository.ts`, `.errors.ts`, `.service.ts`, `.controller.ts`, `.module.ts`, ya conectados entre sí) y `docs/specs/<modulo>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada: si el módulo existe, falla.

Lee `DB_DRIVER` de `compose.db.yaml`, igual que `app-setup.sh`. Con MongoDB (`mongodb`) agrega `<modulo>.model.ts` (clase `@Schema` + `SchemaFactory`), el repository inyecta el `Model` (`@InjectModel`) y el módulo lo registra con `MongooseModule.forFeature`; el contrato trae la tabla del modelo Mongoose en vez de la de Prisma. Con una BD SQL o sin BD, el repository es de Prisma.

Después del scaffold:
1. Llena el contrato con el usuario: firmas y tablas, no prosa. Márcalo `Estado: cerrado`.
2. Orquestador: registra el módulo en `src/app.module.ts` (el script imprime la línea). Con Prisma, agrega el modelo a `prisma/schema.prisma` y `make migration NAME=<x>` (pide confirmación antes de `make migrate`). Con MongoDB no hay migraciones: el data-writer escribe el modelo y sus índices en `<modulo>.model.ts`, y `make migrate` los crea (en dev ya los crea la app al arrancar).
3. Sigue el flujo de AGENTS.md (zone-check --snapshot → data-writer → logic-writer → web-writer → qa-writer).

`scripts/app-setup.sh` no es para módulos: lo ejecuta `make new-app` (agrega `/health`, `ZodValidationPipe` y Prisma con el adaptador de la BD, o Mongoose con `src/mongo/` si la BD es MongoDB). Si activas la BD después con infra-setup, ejecútalo dentro de `make sh`.
