---
name: gin-scaffold
description: "Crea la estructura de un módulo nuevo de backend Go · Gin (internal/<modulo>/ con model, dto, repository, errors, service y handler) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo en Go, antes de escribir código o contrato a mano."
allowed-tools: Bash(bash .agents/skills/gin-scaffold/scripts/scaffold.sh:*)
---

# gin-scaffold

```bash
bash .agents/skills/gin-scaffold/scripts/scaffold.sh <modulo>   # nombre de paquete Go: orders, userprofiles
```

Crea `internal/<modulo>/` con un archivo por capa (solo la cláusula `package` y un comentario: compila vacío) y `docs/specs/<modulo>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada.

Después del scaffold:
1. Llena el contrato con el usuario: firmas y tablas, no prosa. Márcalo `Estado: cerrado`.
2. Crea la migración con `make migration NAME=create_<modulo>` y escribe su SQL a partir de la tabla del contrato (orquestador).
3. Sigue el flujo de AGENTS.md: data-writer → logic-writer → web-writer → qa-writer.
4. Registra el módulo en la lista `modules` de `cmd/api/main.go` (el script imprime la línea). Es tarea del orquestador.

## Con MongoDB (`DB_DRIVER: mongodb` en `compose.db.yaml`)

- `model.go` ya trae `CollectionName`, el struct con `ID string \`bson:"_id"\`` (UUID en texto de `db.NewID()`) y `var Indexes = db.Collection{…}` vacío; `repository.go` dice que va sobre MongoDB. El contrato lleva la colección en lugar de la tabla.
- No hay migración: el paso 2 es agregar `<modulo>.Indexes,` en `collections()` de `cmd/api/main.go` (el script imprime la línea). `make migrate` crea los índices declarados y nunca borra uno.

`scripts/mongo-setup.sh` (lo corre `make new-app` antes de `go mod tidy`; sin red; con otra BD no hace nada) pasa el esqueleto a MongoDB con el driver oficial `go.mongodb.org/mongo-driver/v2` v2.9.2:
- En `go.mod` quita GORM, sus drivers y goose y agrega mongo-driver; el resto de tus líneas se conserva. `go mod tidy` limpia las indirectas.
- Copia `assets/mongo/` (`cmd/api/main.go`, `internal/platform/config`, `internal/platform/db`) y borra `internal/platform/db/migrate.go` y `migrations/`.
- Solo reemplaza o borra un archivo que sigue siendo el esqueleto intacto de basekit (o que ya es la variante MongoDB). Si alguno cambió, o si `migrations/` tiene `.sql`, se detiene, nombra los archivos y no toca nada.
- Es idempotente. Para pasar a MongoDB después de `make new-app`: activa la BD con infra-setup, borra `go.sum` y vuelve a ejecutar `make new-app`.
