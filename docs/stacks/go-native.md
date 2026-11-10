# Stack: Go · Nativo (net/http + database/sql, sin framework) · v1

Plantillas: `plantillas/stacks/go-native/`. Etiqueta en `init`: «Go · Nativo (net/http + database/sql, sin framework)». Lenguaje: Go. Tipo: `backend`. Auth por defecto: **JWT propio** (access + refresh rotado). Puerto: 8080. Healthcheck: `/health`.

API REST solo con la biblioteca estándar: `net/http` con los patrones de método y ruta de `ServeMux` (Go 1.22+) y `database/sql` con SQL escrito a mano. Sin Gin, Echo, Chi, Fiber ni gorilla/mux; sin GORM ni sqlx. Es el stack `gin` con dos capas cambiadas (web y datos): goose, Docker, `scratch`, air, roles, zonas y versiones son los mismos.

## Elección (sin detección automática)

`go-native` **nunca se detecta solo**: su `detect` está vacío, como todos los stacks nativos (un `go.mod` sin framework no se distingue de forma fiable de uno con un router que aún no se importa). Se elige en la pregunta de `init` (Tipo → Lenguaje → Template) o con `--stack go-native`. Un `go.mod` con `github.com/gin-gonic/gin` sigue detectándose como `gin`.

## Arquitectura (módulos por entidad)

```text
go.mod  go.sum                    # orquestador; staticcheck fijado con la directiva `tool`
.air.toml                         # recarga en caliente de make dev (orquestador)
cmd/api/main.go                   # serve · migrate · migration · healthcheck; registro de módulos (orquestador)
migrations/                       # *.sql de goose + migrations.go (embed) (orquestador)
internal/
├── platform/                     # orquestador
│   ├── config/  config.go        # variables de entorno de los overlays
│   ├── db/      db.go errors.go migrate.go  # pool database/sql, Querier + Rebind, InTx, IsUniqueViolation; goose
│   ├── http/    server.go middleware.go json.go  # ServeMux, middleware, helpers JSON, apagado ordenado
│   ├── cache/   redis.go         # go-redis desde REDIS_URL (opcional)
│   └── auth/                     # JWT (se crea con gonative-patterns/references/auth.md)
└── <m>/
    ├── model.go  dto.go  repository.go   # data-writer
    ├── errors.go  service.go             # logic-writer (sin net/http ni database/sql)
    ├── handler.go                        # web-writer
    └── *_test.go                         # qa-writer
```

## Capa web propia (`internal/platform/http`)

| Archivo | Qué hace |
|---|---|
| `server.go` | `NewRouter(opts, modules...)`: `ServeMux` con `GET /health` y los `Registrar` de cada módulo (`Register(mux *http.ServeMux)`). El 404 y el 405 del mux (texto plano por defecto) salen en JSON; el 405 conserva `Allow`. `Run` con timeouts y apagado ordenado (10 s) |
| `middleware.go` | Cadena, de fuera hacia dentro: request ID (reutiliza un `X-Request-ID` válido o crea uno con `rand.Text()` y lo devuelve), límite de cuerpo (1 MiB con `MaxBytesReader`), log de acceso con `slog` (patrón de la ruta, nunca el path crudo; `/health` no se registra), recuperación de pánicos (500 en JSON sin detalles), CORS con orígenes explícitos |
| `json.go` | `WriteJSON`, `WriteError` (`{"error": "…"}`), `ServerError` (log + 500), `DecodeJSON` (un solo objeto, `DisallowUnknownFields`, llama a `Validate()`; 413 o 422) y `QueryInt` (entero acotado) |

- Rutas con el método en el patrón: `mux.Handle("GET /products/{id}", h.authn(http.HandlerFunc(h.get)))` y `r.PathValue("id")`. Un método que no existe en una ruta conocida → 405 del mux, sin código propio.
- El middleware de auth es un `apphttp.Middleware` (`func(http.Handler) http.Handler`) que el handler recibe por constructor; los tests lo sustituyen.
- Validación sin librería: cada DTO de entrada tiene `Validate() error` escrito a mano.
- Un cuerpo malformado, con un campo desconocido, con datos tras el objeto o que no pasa `Validate` → 422 sin repetir la entrada (igual que `gin`). No se exige `Content-Type`.

## Datos: database/sql + goose

Elección: **`database/sql`** con SQL a mano y **goose** (como `gin`) para las migraciones SQL versionadas. Todos los drivers son Go puro, así que el binario compila con `CGO_ENABLED=0` y corre en `scratch`.

| `DB_DRIVER` | Driver (`sql.Open`) | Conexión |
|---|---|---|
| `postgres` | `github.com/jackc/pgx/v5/stdlib` (`pgx`) | `DATABASE_URL` tal cual (`postgresql://…`) |
| `mysql` | `github.com/go-sql-driver/mysql` (`mysql`) | DSN armado desde `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` y `DB_PASSWORD` (`parseTime=true`, utf8mb4) |
| `sqlite` | `modernc.org/sqlite` (`sqlite`, sin CGO) | `DB_DATABASE` (`/app/data/app.db`) con `foreign_keys`, `busy_timeout` y WAL; una sola conexión |

Las versiones son las mismas que pide goose 3.29.0 (pgx 5.11.0, mysql 1.10.1, modernc sqlite 1.60.1): fijarlas no mueve el grafo de módulos.

- **Placeholders por dialecto**: el repositorio escribe siempre `?`; `db.Querier` (lo implementan `*db.DB` y la transacción de `InTx`) los reescribe a `$1`, `$2`… solo en postgres. Un solo SQL para los tres motores sin depender de sqlx. `Rebind` ignora los `?` dentro de cadenas, identificadores entre comillas y comentarios `--`.
- **Duplicados**: `db.IsUniqueViolation(err)` reconoce postgres 23505, mysql 1062 y los códigos UNIQUE/PRIMARY KEY de SQLite.
- **Transacciones**: `database.InTx(ctx, func(q db.Querier) error { … })` hace commit si `fn` devuelve nil y rollback si no.
- **goose** recibe el `*sql.DB` crudo (`database.Pool()`): escribe su propio SQL por dialecto, así que no pasa por `Rebind`.
- **`make migration NAME=x`** ejecuta `go run ./cmd/api migration x` y crea `migrations/<timestamp>_x.sql` con `-- +goose Up` y `-- +goose Down`. **`make migrate`** levanta el servicio `migrate` (`api migrate`; también `down` y `status`).
- El SQL de ejemplo es portable entre los tres motores: ids `VARCHAR(26)` generados en Go (`crypto/rand.Text()`), dinero en centavos y `TIMESTAMP` (el service trunca a microsegundos, la precisión que guardan los tres).

**Esqueleto**: Go no tiene generador. Si falta `go.sum` (el `appMarker`), el CLI copia `starter/`: `go.mod` con versiones exactas (goose 3.29.0, pgx 5.11.0, mysql 1.10.1, modernc sqlite 1.60.1, go-redis 9.23.0 y staticcheck 0.8.2 como herramienta), `cmd/api/main.go`, `internal/platform/**` y `migrations/migrations.go`, con tests de las rutas (404/405/413/422/500 en JSON, request ID, CORS) y de los datos (`Rebind`, migración + consulta + duplicado + rollback sobre SQLite). Después, `make new-app` ejecuta `go mod tidy` en `golang:1.27.3-trixie` y crea `go.sum`; si `go.sum` ya existe, no hace nada ni llama a Docker.

Sin overlay de base de datos, la API arranca solo con `/health`, y `make migrate` informa que no hay nada que aplicar y termina con 0. Redis llega por `REDIS_URL`; `internal/platform/cache` abre el cliente solo si la variable existe.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `go.mod`, `go.sum`, `go.work`, `.air.toml`, `cmd/**`, `internal/platform/**`, `migrations/**` |
| data-writer | `internal/*/model.go`, `dto.go`, `repository.go` |
| logic-writer | `internal/*/service.go`, `errors.go` |
| web-writer | `internal/*/handler.go` |
| qa-writer | `internal/*/*_test.go`, `internal/*/testdata/**` |

Skills: `gonative-scaffold`, `gonative-verify` (la usa `make verify`; gofmt, go vet, staticcheck y go test, sin red) y `gonative-patterns` (+ `references/auth.md`). El ejemplo `products` de `gonative-patterns` se compiló y sus tests pasan (401, 422, 404, 201, 405 y 413).

## Docker

Igual que `gin`:

| Target | Uso |
|---|---|
| `dev` | `golang:1.27.3-trixie` con air v1.67.4; módulos y staticcheck descargados en la imagen; bind mount del proyecto y volumen de caché de compilación |
| `build` → `prod` | Binario estático (`CGO_ENABLED=0`, `-trimpath`) copiado a `scratch` con los certificados CA; usuario 1001; `read_only` + `tmpfs`, `cap_drop: [ALL]` |

- **`scratch` no tiene shell ni curl**: el `HEALTHCHECK` es el propio binario (`/app/api healthcheck`), que hace GET a `/health` y sale con 0 o 1.
- **`migrate`** usa `go run ./cmd/api migrate` en dev y el binario (`command: ["migrate"]`) en prod, también `read_only`.
- **`make deps-add PKGS="modulo@vX.Y.Z"`** exige versión exacta, ejecuta `go get` + `go mod tidy` en Docker y reconstruye.
- **`make lint`**: gofmt, go vet y staticcheck.

## Auth: JWT (detalle en `gonative-patterns/references/auth.md`)

1. Dependencias: `make deps-add PKGS="github.com/golang-jwt/jwt/v5@v5.3.1 golang.org/x/crypto@v0.58.0"`.
2. `internal/platform/auth`: HS256 fijo con `jwt.WithValidMethods`; exige `exp`, `iss` y `aud`. `Required(cfg)` y `RequireRole(role)` son `apphttp.Middleware` y dejan el usuario en el `context.Context` de la petición.
3. Contraseñas con argon2id y un `dummyHash` para que el login tarde lo mismo exista o no el usuario.
4. Refresh aleatorio guardado como SHA-256, con rotación por familia; en navegador, cookie `HttpOnly` + `Secure` + `SameSite=Lax` con `http.SetCookie`.

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

- **Entrada**: `DecodeJSON` rechaza campos extra y datos tras el objeto; 422 sin repetir la entrada; 413 por encima de 1 MiB.
- **Salida**: siempre el DTO `<X>Response`, nunca el modelo; `X-Content-Type-Options: nosniff` en cada JSON.
- **SQL**: placeholders `?` siempre; nunca `fmt.Sprintf` ni concatenación con datos del usuario. `ORDER BY` dinámico solo desde un mapa cerrado.
- **Autorización por recurso**: en el service; un recurso ajeno responde 404.
- **Límites**: timeouts de lectura y escritura en el `http.Server`; paginación de 100 como máximo.
- **CORS**: solo los orígenes de `CORS_ORIGINS`, nunca `*` con credenciales.
- **Pánicos**: 500 en JSON sin trazas; el detalle va al log con el request ID. `http.ErrAbortHandler` se deja pasar.
- **Logs**: el patrón de la ruta (`GET /products/{id}`), no el path crudo.

## Diferencias con `gin`

| | `gin` | `go-native` |
|---|---|---|
| Rutas | `gin.IRouter`, `:id` | `http.ServeMux`, `{id}` con `r.PathValue` |
| Entrada | `ShouldBindJSON` + tags `binding` | `DecodeJSON` + `Validate()` a mano |
| Datos | GORM (`TranslateError`) | `database/sql` + `Querier`/`Rebind` + `IsUniqueViolation` |
| SQLite | `github.com/glebarez/sqlite` (GORM) | `modernc.org/sqlite` (database/sql) |
| Dependencias directas | 8 | 5 |

## Errores comunes

- Registrar una ruta sin método (`"/products"`): acepta cualquier método y el mux ya no responde 405.
- Escribir `$1` en el repositorio: rompe mysql y sqlite. Escribe `?`.
- Copiar la petición (`r.WithContext`) en un middleware entre el log de acceso y el mux: el log pierde `r.Pattern`.
- `SELECT *` y olvidar `rows.Close()` o `rows.Err()`.
- Declarar la interfaz `Repository` en `repository.go` (es del consumidor).
- Activar CGO (`mattn/go-sqlite3`): rompe la imagen `scratch`.
- Editar una migración ya aplicada: crea una nueva.
