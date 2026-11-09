# Stack: Go · Gin (API REST) · v1

Plantillas: `plantillas/stacks/gin/`. Etiqueta en `init`: «Go · Gin (API REST) + GORM». Lenguaje: Go. Tipo: `backend`. Auth por defecto: **JWT propio** (access + refresh rotado). Puerto: 8080. Healthcheck: `/health`.

Es el primer stack del lenguaje Go. Gin es el framework web de Go más usado.

**Detección**: `go.mod` que contiene `github.com/gin-gonic/gin`. Un proyecto Go sin Gin (Echo, Chi, Fiber) no se detecta; se elige con la pregunta o con `--stack gin`.

## Arquitectura (módulos por entidad)

```text
go.mod  go.sum                    # orquestador; staticcheck fijado con la directiva `tool`
.air.toml                         # recarga en caliente de make dev (orquestador)
cmd/api/main.go                   # serve · migrate · migration · healthcheck; registro de módulos (orquestador)
migrations/                       # *.sql de goose + migrations.go (embed) (orquestador)
internal/
├── platform/                     # orquestador
│   ├── config/  config.go        # variables de entorno de los overlays
│   ├── db/      db.go migrate.go # GORM por DB_DRIVER; goose sobre las migraciones embebidas
│   ├── http/    server.go        # Gin, /health, CORS, límite de cuerpo, JSON en 404/405/500, apagado ordenado
│   ├── cache/   redis.go         # go-redis desde REDIS_URL (opcional)
│   └── auth/                     # JWT (se crea con gin-patterns/references/auth.md)
└── <m>/
    ├── model.go  dto.go  repository.go   # data-writer
    ├── errors.go  service.go             # logic-writer (sin Gin ni net/http)
    ├── handler.go                        # web-writer
    └── *_test.go                         # qa-writer
```

Reglas de Go que siguen las plantillas:
- **Interfaces definidas por el consumidor**: `Repository` vive en `service.go`; `service` en `handler.go`. Los tests las implementan con fakes.
- **Contexto propagado**: `c.Request.Context()` → service → `db.WithContext(ctx)`.
- **Errores envueltos** con `%w` y comparados con `errors.Is`.
- **Apagado ordenado**: `signal.NotifyContext` con SIGTERM; el servidor drena peticiones hasta 10 s.

**Esqueleto**: Go no tiene generador. Si falta `go.sum` (el `appMarker`), el CLI copia `starter/`:
- `go.mod` con versiones exactas: Gin 1.12.0, GORM 1.31.2 y sus drivers, goose 3.29.0, go-redis 9.23.0 y staticcheck 0.8.2 como herramienta.
- `cmd/api/main.go`, `internal/platform/**` y `migrations/migrations.go`.
- Un test de `/health`, del 404 en JSON y de CORS.

Después, `make new-app` ejecuta `go mod tidy` en `golang:1.27.3-trixie` y crea `go.sum`. Si `go.sum` ya existe, no hace nada ni llama a Docker. Es el mismo patrón que express, flask y django (esqueleto + lockfile como marca): aquí `go.sum` es el lockfile.

Sin overlay de base de datos, la API arranca solo con `/health`, y `make migrate` informa que no hay nada que aplicar y termina con 0. Redis llega por `REDIS_URL` (y `REDIS_PASSWORD`); `internal/platform/cache` abre el cliente solo si la variable existe.

## Datos: GORM + goose

Elección: **GORM** para las consultas y **goose** para las migraciones SQL versionadas. Las dos son las más usadas en Go para cada tarea, y todos los drivers son Go puro, así que el binario compila con `CGO_ENABLED=0` y corre en `scratch`.

| `DB_DRIVER` | Driver | Conexión |
|---|---|---|
| `postgres` | `gorm.io/driver/postgres` (pgx) | `DATABASE_URL` tal cual (`postgresql://…`) |
| `mysql` | `gorm.io/driver/mysql` | DSN armado desde `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` y `DB_PASSWORD` (`parseTime=true`, utf8mb4) |
| `sqlite` | `github.com/glebarez/sqlite` (modernc, sin CGO) | `DB_DATABASE` (`/app/data/app.db`) con `foreign_keys`, `busy_timeout` y WAL; una sola conexión |

- **`make migration NAME=x`** ejecuta `go run ./cmd/api migration x` y crea `migrations/<timestamp>_x.sql` con las secciones `-- +goose Up` y `-- +goose Down`.
- **`make migrate`** levanta el servicio `migrate`, que ejecuta `api migrate`: aplica las migraciones embebidas con el `Provider` de goose. También acepta `down` y `status`.
- **AutoMigrate no se usa**: el esquema lo fija el SQL revisado.
- El SQL de ejemplo es portable entre los tres motores: ids `VARCHAR(26)` generados en Go (`crypto/rand.Text()`), dinero en centavos y `TIMESTAMP`.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `go.mod`, `go.sum`, `go.work`, `.air.toml`, `cmd/**`, `internal/platform/**`, `migrations/**` |
| data-writer | `internal/*/model.go`, `dto.go`, `repository.go` |
| logic-writer | `internal/*/service.go`, `errors.go` |
| web-writer | `internal/*/handler.go` |
| qa-writer | `internal/*/*_test.go`, `internal/*/testdata/**` |

Skills: `gin-scaffold`, `gin-verify` (la usa `make verify`; gofmt, go vet, staticcheck y go test, sin red) y `gin-patterns` (+ `references/auth.md`).

## Docker

| Target | Uso |
|---|---|
| `dev` | `golang:1.27.3-trixie` con air v1.67.4; módulos y staticcheck descargados en la imagen; bind mount del proyecto y volumen de caché de compilación |
| `build` → `prod` | Binario estático (`CGO_ENABLED=0`, `-trimpath`) copiado a `scratch` con los certificados CA; usuario 1001; `read_only` + `tmpfs`, `cap_drop: [ALL]` |

- **`scratch` no tiene shell ni curl**: el `HEALTHCHECK` es el propio binario (`/app/api healthcheck`), que hace GET a `/health` y sale con 0 o 1.
- **`/app/data`** (volumen de SQLite) toma el dueño 1001 de la imagen.
- **`migrate`** usa `go run ./cmd/api migrate` en dev y el binario (`command: ["migrate"]`) en prod, también `read_only`.
- **`make deps-add PKGS="modulo@vX.Y.Z"`** exige versión exacta, ejecuta `go get` + `go mod tidy` en Docker y reconstruye.
- **`make lint`**: gofmt, go vet y staticcheck.

## Auth: JWT (detalle en `gin-patterns/references/auth.md`)

1. Dependencias: `make deps-add PKGS="github.com/golang-jwt/jwt/v5@v5.3.1 golang.org/x/crypto@v0.58.0"`.
2. `internal/platform/auth`:
   - HS256 fijo con `jwt.WithValidMethods`; exige `exp`, `iss` y `aud`.
   - `Required(cfg)` deja el usuario en el `context.Context` de la petición; `RequireRole(role)`.
   - El handler recibe el middleware por constructor (`NewHandler(svc, auth.Required(cfg))`), así los tests lo sustituyen.
3. Contraseñas con argon2id (`golang.org/x/crypto/argon2`) y un `dummyHash` para que el login tarde lo mismo exista o no el usuario.
4. Refresh aleatorio guardado como SHA-256, con rotación por familia.
5. Variables: `JWT_SECRET=__GENERATE__`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES=15`, `REFRESH_TOKEN_DAYS=14`.

## Comandos

```bash
make new-app                  # go mod tidy → go.sum (una vez)
make dev
make test
make verify SCOPE=internal/<m>
make migration NAME=x         # goose, SQL
make migrate
make deps-add PKGS="modulo@vX.Y.Z"
```

## Seguridad específica

- **Entrada**: `binding.EnableDecoderDisallowUnknownFields` rechaza campos extra; un error de binding responde 422 sin repetir la entrada.
- **Salida**: siempre el DTO `<X>Response`, nunca el modelo GORM.
- **SQL**: GORM con `?`; nunca `fmt.Sprintf` con datos del usuario en `Where`, `Order` ni `Raw`.
- **Autorización por recurso**: en el service; un recurso ajeno responde 404.
- **Proxies**: `SetTrustedProxies(nil)`; confía en tu proxy de forma explícita si necesitas la IP real.
- **Límites**: cuerpo máximo de 1 MiB; timeouts de lectura y escritura en el `http.Server`; paginación de 100 como máximo.
- **CORS**: solo los orígenes de `CORS_ORIGINS`, nunca `*` con credenciales.
- **Pánicos**: recuperación con 500 en JSON sin trazas; el detalle va al log.

## Errores comunes

- Usar `*gin.Context` como `context.Context` en el service o guardarlo en una goroutine.
- Declarar la interfaz `Repository` en `repository.go` (es del consumidor).
- `AutoMigrate` en el arranque en lugar de una migración.
- Activar CGO (`mattn/go-sqlite3`): rompe la imagen `scratch`.
- Editar una migración ya aplicada: crea una nueva.
- Ejecutar `go get` en el host sin versión exacta.
