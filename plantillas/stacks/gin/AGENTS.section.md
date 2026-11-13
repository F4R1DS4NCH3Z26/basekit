## Stack: Go · Gin (API REST)
- Go 1.27 con módulos (`go.mod` + `go.sum`), todo dentro de Docker. Datos: GORM + migraciones SQL versionadas con goose (embebidas en el binario); con MongoDB (`DB_DRIVER: mongodb`), el driver oficial `go.mongodb.org/mongo-driver/v2` sin migraciones: cada módulo declara sus índices (`Indexes` en `model.go`, listados en `collections()` de `cmd/api/main.go`) y `make migrate` los crea, nunca borra uno. Auth: JWT propio (`internal/platform/auth`). Tests: `go test` con `httptest` y SQLite en memoria.
- `cmd/api/main.go`: subcomandos `serve`, `migrate`, `migration` y `healthcheck`; registro de módulos. `internal/platform/`: `config`, `db`, `http` (Gin, `/health`, CORS, apagado ordenado), `cache` (Redis).
- `internal/<m>/`: `model.go` · `dto.go` · `repository.go` · `errors.go` · `service.go` (sin HTTP) · `handler.go` · `*_test.go`.
- La interfaz la define quien la consume (`Repository` en `service.go`). `context.Context` primero; errores con `%w`. DTO de entrada sin campos del servidor; salida siempre por `<X>Response`.

| Rol | Zona |
|---|---|
| orquestador | lo común + `go.mod`, `go.sum`, `.air.toml`, `cmd/**`, `internal/platform/**`, `migrations/**` |
| data-writer | `model.go`, `dto.go`, `repository.go` |
| logic-writer | `service.go`, `errors.go` |
| web-writer | `handler.go` |
| qa-writer | `internal/*/*_test.go` |

Comandos: `make dev` (puerto 8080, recarga con air) · `make test` · `make verify SCOPE=internal/<m>` · `make migration NAME=x` (goose; con MongoDB solo lo explica) · `make migrate` · `make deps-add PKGS="mod@vX.Y.Z"`
