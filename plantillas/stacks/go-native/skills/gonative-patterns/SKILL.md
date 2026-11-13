---
name: gonative-patterns
description: "Código de referencia seguro para un módulo Go nativo (net/http + database/sql, sin framework): migración SQL (goose) portable, modelo (o MongoDB con mongo-driver v2: modelo con tags bson e índices declarados), DTO con Validate, repositorio con SQL a mano y placeholders ?, service con interfaz definida por el consumidor, handler con patrones de ServeMux, auth y errores traducidos, y tests con httptest y SQLite en memoria. Úsala SIEMPRE antes de escribir model, dto, repository, service, handler o tests de un módulo Go."
---

# gonative-patterns

Ejemplo con el módulo `products` (paquete `app/internal/products`). Copia la forma y cambia los nombres. Busca con Grep lo que ya existe en `internal/platform/` (`auth`, `http`, `db`) antes de asumir sus nombres; la auth se crea con `references/auth.md`.

Reglas comunes:
- Solo la biblioteca estándar en la capa web: `net/http` con patrones de Go 1.22+ (`"GET /products/{id}"`). Nada de Gin, Echo, Chi, Fiber ni gorilla/mux; nada de GORM ni sqlx.
- `context.Context` es el primer parámetro de todo lo que hace I/O; el handler pasa `r.Context()`.
- La interfaz la declara quien la consume: `Repository` vive en `service.go` y `service` en `handler.go`.
- Errores envueltos con `fmt.Errorf("…: %w", err)` y comparados con `errors.Is`.
- Sin `init()` ni variables globales mutables en los módulos.

Lo que ya trae `internal/platform/` (orquestador):

| Paquete | Qué usas |
|---|---|
| `db` | `db.Querier` (`ExecContext`, `QueryContext`, `QueryRowContext`), `(*db.DB).InTx(ctx, fn)`, `db.IsUniqueViolation(err)`, `db.Rebind` |
| `http` (`apphttp`) | `Registrar`, `Middleware`, `WriteJSON`, `WriteError`, `ServerError`, `DecodeJSON` (413/422 + `Validate`), `QueryInt`, `RequestID`, `MaxBodyBytes` |

**Placeholders por dialecto**: el repositorio escribe siempre `?` y `db.Querier` los reescribe a `$1`, `$2`… solo en postgres (mysql y sqlite usan `?`). Así un solo SQL sirve para los tres motores sin depender de sqlx. `Rebind` ignora los `?` dentro de 'cadenas', "identificadores" y comentarios `--`; el operador `?` de jsonb no existe para el repositorio: usa `jsonb_exists(col, ?)`.

## Migración — orquestador (`make migration NAME=create_products`)

SQL portable entre postgres, mysql y sqlite: ids `VARCHAR(26)` generados en Go (`rand.Text()`), dinero en centavos (`BIGINT`), `TIMESTAMP` en UTC. Si una sentencia no es portable, escribe una migración por motor o elige un solo motor en la ADR.

```sql
-- +goose Up
CREATE TABLE products (
    id          VARCHAR(26)  PRIMARY KEY,
    owner_id    VARCHAR(26)  NOT NULL,
    name        VARCHAR(120) NOT NULL,
    price_cents BIGINT       NOT NULL,
    created_at  TIMESTAMP    NOT NULL
);
CREATE INDEX ix_products_owner_id ON products (owner_id);

-- +goose Down
DROP TABLE products;
```

## Variante MongoDB (`DB_DRIVER: mongodb` en `compose.db.yaml`)

Con MongoDB, `make new-app` cambió el esqueleto (`gonative-scaffold/scripts/mongo-setup.sh`): no hay `database/sql`, goose ni `migrations/`; `internal/platform/db` abre `*mongo.Database` desde `MONGO_URL` (driver oficial `go.mongodb.org/mongo-driver/v2`). Cambia solo la capa de datos; DTO, service, handler y tests siguen igual, salvo el id:
- **Migraciones: no hay.** Cada módulo declara sus índices en `model.go` (`var Indexes = db.Collection{…}`) y el orquestador los lista en `collections()` de `cmd/api/main.go`. `make migrate` (`api migrate`) los crea en dev y en prod; `make dev` también al arrancar (en prod no: construir un índice sobre una colección grande la carga). `make migration` solo explica esto.
- **Nunca se borra un índice solo**: quitarlo de `Indexes` no lo quita de la BD. Para borrarlo: `make db-shell` (`ENV=prod` en producción), `db.<colección>.getIndexes()` y `db.<colección>.dropIndex('<nombre>')`.
- **Id**: `_id` es un UUID en texto; el service lo asigna con `db.NewID()` en lugar de `rand.Text()`.
- **Clave duplicada** (índice único): `db.IsUniqueViolation(err)` (ahora sobre `mongo.IsDuplicateKeyError`) → el error del contrato (por ejemplo `ErrNameTaken`).

`model.go`:

```go
package products

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"app/internal/platform/db"
)

// CollectionName is the MongoDB collection of this module.
const CollectionName = "products"

// Product is one document. ID is a UUID string (db.NewID()) stored as _id.
type Product struct {
	ID         string    `bson:"_id"`
	OwnerID    string    `bson:"owner_id"`
	Name       string    `bson:"name"`
	PriceCents int64     `bson:"price_cents"`
	CreatedAt  time.Time `bson:"created_at"`
}

// Indexes: make migrate creates them (make dev too, at startup). Removing one here does not drop it.
var Indexes = db.Collection{Name: CollectionName, Indexes: []mongo.IndexModel{
	{Keys: bson.D{{Key: "owner_id", Value: 1}, {Key: "created_at", Value: -1}}},
	{Keys: bson.D{{Key: "owner_id", Value: 1}, {Key: "name", Value: 1}}, Options: options.Index().SetUnique(true)},
}}
```

`repository.go`:

```go
package products

import (
	"context"
	"errors"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// MongoRepository implements the Repository that service.go declares.
type MongoRepository struct {
	c *mongo.Collection
}

func NewRepository(database *mongo.Database) *MongoRepository {
	return &MongoRepository{c: database.Collection(CollectionName)}
}

func (r *MongoRepository) Create(ctx context.Context, p *Product) error {
	if _, err := r.c.InsertOne(ctx, p); err != nil {
		return fmt.Errorf("products: create: %w", err)
	}
	return nil
}

func (r *MongoRepository) Get(ctx context.Context, id string) (Product, error) {
	var p Product
	err := r.c.FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&p) // typed filter, never a map built from the body
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Product{}, ErrNotFound
	}
	if err != nil {
		return Product{}, fmt.Errorf("products: get: %w", err)
	}
	return p, nil
}

func (r *MongoRepository) ListByOwner(ctx context.Context, ownerID string, limit, offset int) ([]Product, error) {
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(int64(limit)).SetSkip(int64(offset))
	cur, err := r.c.Find(ctx, bson.D{{Key: "owner_id", Value: ownerID}}, opts)
	if err != nil {
		return nil, fmt.Errorf("products: list: %w", err)
	}
	out := []Product{}
	if err := cur.All(ctx, &out); err != nil {
		return nil, fmt.Errorf("products: list: %w", err)
	}
	return out, nil
}
```

Registro (orquestador, `cmd/api/main.go`): `products.Indexes,` en `collections()` y `products.NewHandler(products.NewService(products.NewRepository(database)), auth.Required(authCfg)),` en `modules`.

Tests con MongoDB: no hay MongoDB en memoria, así que `make test` y `make verify` no tocan la BD. El service y el handler se prueban con fakes (igual que con SQL); el repositorio no lleva test unitario.

## model.go — data-writer

```go
package products

import "time"

// Product mirrors one row of the products table. The schema is owned by the SQL migration.
type Product struct {
	ID         string
	OwnerID    string
	Name       string
	PriceCents int64
	CreatedAt  time.Time
}
```

## dto.go — data-writer

```go
package products

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// CreateProductRequest is the only input shape. It never carries ID, OwnerID or dates (mass assignment):
// DecodeJSON rejects unknown fields.
type CreateProductRequest struct {
	Name       string `json:"name"`
	PriceCents int64  `json:"price_cents"`
}

// Validate is called by apphttp.DecodeJSON; any error becomes a 422 without echoing the input.
func (in CreateProductRequest) Validate() error {
	var errs []error
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Name)); n < 1 || n > 120 {
		errs = append(errs, errors.New("name: entre 1 y 120 caracteres"))
	}
	if in.PriceCents <= 0 {
		errs = append(errs, errors.New("price_cents: mayor que 0"))
	}
	return errors.Join(errs...)
}

// ProductResponse is the only output shape: internal fields never leak.
type ProductResponse struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	PriceCents int64     `json:"price_cents"`
	CreatedAt  time.Time `json:"created_at"`
}

func toProductResponse(p Product) ProductResponse {
	return ProductResponse{ID: p.ID, Name: p.Name, PriceCents: p.PriceCents, CreatedAt: p.CreatedAt}
}
```

## repository.go — data-writer

```go
package products

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"app/internal/platform/db"
)

// SQLRepository implements the Repository that service.go declares, with hand-written SQL.
// Placeholders are always `?`: db.Querier rewrites them to $1, $2… on postgres.
type SQLRepository struct {
	q db.Querier
}

// NewRepository receives *db.DB, or the Querier of db.InTx inside a transaction.
func NewRepository(q db.Querier) *SQLRepository {
	return &SQLRepository{q: q}
}

const productColumns = "id, owner_id, name, price_cents, created_at"

// scanner is satisfied by *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanProduct(s scanner) (Product, error) {
	var p Product
	err := s.Scan(&p.ID, &p.OwnerID, &p.Name, &p.PriceCents, &p.CreatedAt)
	return p, err
}

func (r *SQLRepository) Create(ctx context.Context, p *Product) error {
	_, err := r.q.ExecContext(ctx,
		"INSERT INTO products ("+productColumns+") VALUES (?, ?, ?, ?, ?)",
		p.ID, p.OwnerID, p.Name, p.PriceCents, p.CreatedAt)
	if err != nil {
		return fmt.Errorf("products: create: %w", err)
	}
	return nil
}

func (r *SQLRepository) Get(ctx context.Context, id string) (Product, error) {
	// bound parameter, never Sprintf
	p, err := scanProduct(r.q.QueryRowContext(ctx, "SELECT "+productColumns+" FROM products WHERE id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return Product{}, ErrNotFound
	}
	if err != nil {
		return Product{}, fmt.Errorf("products: get: %w", err)
	}
	return p, nil
}

func (r *SQLRepository) ListByOwner(ctx context.Context, ownerID string, limit, offset int) ([]Product, error) {
	rows, err := r.q.QueryContext(ctx,
		"SELECT "+productColumns+" FROM products WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
		ownerID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("products: list: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []Product
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			return nil, fmt.Errorf("products: list: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("products: list: %w", err)
	}
	return out, nil
}
```

Duplicados: `if db.IsUniqueViolation(err) { return ErrEmailTaken }` (postgres 23505, mysql 1062, sqlite UNIQUE/PRIMARY KEY). Varias escrituras atómicas: un método del repositorio que recibe el `*db.DB` (no un `Querier`) llama `InTx(ctx, func(q db.Querier) error { tx := NewRepository(q); … })` y reutiliza las mismas consultas sobre la transacción; el service sigue sin saber de SQL.

## errors.go y service.go — logic-writer

```go
package products

import "errors"

var (
	ErrNotFound  = errors.New("products: no encontrado")
	ErrForbidden = errors.New("products: prohibido")
)
```

```go
// Package products is the products module. Contract: docs/specs/products_contract.md.
package products

import (
	"context"
	"crypto/rand"
	"fmt"
	"time"
)

// MaxPage caps every listing.
const MaxPage = 100

// Repository is what the service needs; SQLRepository implements it and tests fake it.
type Repository interface {
	Create(ctx context.Context, p *Product) error
	Get(ctx context.Context, id string) (Product, error)
	ListByOwner(ctx context.Context, ownerID string, limit, offset int) ([]Product, error)
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

func (s *Service) Create(ctx context.Context, ownerID string, in CreateProductRequest) (Product, error) {
	p := Product{
		ID:         rand.Text(), // 26 chars, 130 random bits; portable across postgres, mysql and sqlite
		OwnerID:    ownerID,     // from the authenticated user, never from the body
		Name:       in.Name,
		PriceCents: in.PriceCents,
		CreatedAt:  s.now().UTC().Truncate(time.Microsecond), // the precision every engine keeps
	}
	if err := s.repo.Create(ctx, &p); err != nil {
		return Product{}, fmt.Errorf("crear producto: %w", err)
	}
	return p, nil
}

func (s *Service) Get(ctx context.Context, userID, id string) (Product, error) {
	p, err := s.repo.Get(ctx, id)
	if err != nil {
		return Product{}, fmt.Errorf("leer producto: %w", err)
	}
	if p.OwnerID != userID {
		return Product{}, ErrForbidden
	}
	return p, nil
}

func (s *Service) List(ctx context.Context, userID string, limit, offset int) ([]Product, error) {
	limit = min(max(limit, 1), MaxPage)
	ps, err := s.repo.ListByOwner(ctx, userID, limit, max(offset, 0))
	if err != nil {
		return nil, fmt.Errorf("listar productos: %w", err)
	}
	return ps, nil
}
```

## handler.go — web-writer

```go
package products

import (
	"context"
	"errors"
	"net/http"

	"app/internal/platform/auth"
	apphttp "app/internal/platform/http"
)

// service is what the handler needs from *Service (the consumer defines the interface).
type service interface {
	Create(ctx context.Context, ownerID string, in CreateProductRequest) (Product, error)
	Get(ctx context.Context, userID, id string) (Product, error)
	List(ctx context.Context, userID string, limit, offset int) ([]Product, error)
}

type Handler struct {
	svc   service
	authn apphttp.Middleware
}

// NewHandler receives the auth middleware (auth.Required in main, a fake in tests).
func NewHandler(svc service, authn apphttp.Middleware) *Handler {
	return &Handler{svc: svc, authn: authn}
}

// Register uses Go 1.22+ patterns: the method is part of the route, so a wrong method gets 405
// (with Allow) from the mux, and {id} is read with r.PathValue.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.Handle("POST /products", h.authn(http.HandlerFunc(h.create)))
	mux.Handle("GET /products", h.authn(http.HandlerFunc(h.list)))
	mux.Handle("GET /products/{id}", h.authn(http.HandlerFunc(h.get)))
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	user, _ := auth.FromContext(r.Context())
	var in CreateProductRequest
	if !apphttp.DecodeJSON(w, r, &in) { // 413, 422 (JSON, extra field, Validate) already answered
		return
	}
	p, err := h.svc.Create(r.Context(), user.ID, in)
	if err != nil {
		apphttp.ServerError(w, r, err)
		return
	}
	apphttp.WriteJSON(w, http.StatusCreated, toProductResponse(p))
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	user, _ := auth.FromContext(r.Context())
	limit, err1 := apphttp.QueryInt(r, "limit", 20, 1, MaxPage)
	offset, err2 := apphttp.QueryInt(r, "offset", 0, 0, 1_000_000)
	if err := errors.Join(err1, err2); err != nil {
		apphttp.WriteError(w, http.StatusUnprocessableEntity, "parámetros inválidos")
		return
	}
	ps, err := h.svc.List(r.Context(), user.ID, limit, offset)
	if err != nil {
		apphttp.ServerError(w, r, err)
		return
	}
	out := make([]ProductResponse, 0, len(ps))
	for _, p := range ps {
		out = append(out, toProductResponse(p))
	}
	apphttp.WriteJSON(w, http.StatusOK, out)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	user, _ := auth.FromContext(r.Context())
	p, err := h.svc.Get(r.Context(), user.ID, r.PathValue("id"))
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrForbidden):
		// 404 for someone else's product too: never reveal that it exists
		apphttp.WriteError(w, http.StatusNotFound, "no encontrado")
	case err != nil:
		apphttp.ServerError(w, r, err)
	default:
		apphttp.WriteJSON(w, http.StatusOK, toProductResponse(p))
	}
}
```

Registro (orquestador, `cmd/api/main.go`):

```go
modules := []apphttp.Registrar{
	products.NewHandler(products.NewService(products.NewRepository(database)), auth.Required(authCfg)),
}
```

Lo que ya resuelve `platform/http` y no repites en el handler: 404 y 405 en JSON (el 405 con `Allow`), límite de 1 MiB, campos desconocidos rechazados (`DisallowUnknownFields`), pánicos → 500 sin detalles, `X-Request-ID` y log de acceso con `slog`.

## Tests — qa-writer

`handler_test.go`: router real de `platform/http`, service falso y un middleware de auth falso.

```go
package products

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"app/internal/platform/auth"
	apphttp "app/internal/platform/http"
)

type fakeService struct{ products map[string]Product }

func (f *fakeService) Create(_ context.Context, ownerID string, in CreateProductRequest) (Product, error) {
	return Product{ID: "p1", OwnerID: ownerID, Name: in.Name, PriceCents: in.PriceCents}, nil
}

func (f *fakeService) Get(_ context.Context, userID, id string) (Product, error) {
	p, ok := f.products[id]
	if !ok {
		return Product{}, ErrNotFound
	}
	if p.OwnerID != userID {
		return Product{}, ErrForbidden
	}
	return p, nil
}

func (f *fakeService) List(context.Context, string, int, int) ([]Product, error) { return nil, nil }

// as authenticates every request as userID; an empty userID behaves like auth.Required without a token.
func as(userID string) apphttp.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if userID == "" {
				apphttp.WriteError(w, http.StatusUnauthorized, "no autenticado")
				return
			}
			next.ServeHTTP(w, r.WithContext(auth.WithPrincipal(r.Context(), auth.Principal{ID: userID})))
		})
	}
}

func TestHandler(t *testing.T) {
	svc := &fakeService{products: map[string]Product{"other": {ID: "other", OwnerID: "u2"}}}
	big := `{"name":"` + strings.Repeat("a", apphttp.MaxBodyBytes) + `","price_cents":1}`
	tests := []struct {
		name, user, method, path, body string
		want                           int
	}{
		{"sin auth es 401", "", http.MethodPost, "/products", `{"name":"A","price_cents":100}`, http.StatusUnauthorized},
		{"caso feliz es 201", "u1", http.MethodPost, "/products", `{"name":"A","price_cents":100}`, http.StatusCreated},
		{"campo extra es 422", "u1", http.MethodPost, "/products", `{"name":"A","price_cents":100,"owner_id":"x"}`, http.StatusUnprocessableEntity},
		{"input inválido es 422", "u1", http.MethodPost, "/products", `{"name":"","price_cents":0}`, http.StatusUnprocessableEntity},
		{"cuerpo de más de 1 MiB es 413", "u1", http.MethodPost, "/products", big, http.StatusRequestEntityTooLarge},
		{"producto ajeno es 404", "u1", http.MethodGet, "/products/other", "", http.StatusNotFound},
		{"producto inexistente es 404", "u1", http.MethodGet, "/products/missing", "", http.StatusNotFound},
		{"método equivocado es 405", "u1", http.MethodDelete, "/products/other", "", http.StatusMethodNotAllowed},
		{"limit fuera de rango es 422", "u1", http.MethodGet, "/products?limit=1000", "", http.StatusUnprocessableEntity},
		{"listado es 200", "u1", http.MethodGet, "/products", "", http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := apphttp.NewRouter(apphttp.Options{}, NewHandler(svc, as(tt.user)))
			w := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)
			if w.Code != tt.want {
				t.Fatalf("%s %s = %d, want %d (%.200s)", tt.method, tt.path, w.Code, tt.want, w.Body)
			}
			if strings.Contains(w.Body.String(), "owner_id") {
				t.Fatalf("la respuesta filtra owner_id: %s", w.Body)
			}
		})
	}
}
```

`repository_test.go`: SQLite en memoria (driver Go puro, sin CGO) con el SQL de la migración. Con MongoDB no se escribe (ver la variante MongoDB arriba).

```go
package products

import (
	"context"
	"errors"
	"testing"

	"app/internal/platform/config"
	"app/internal/platform/db"
)

func newTestDB(t *testing.T) *db.DB {
	t.Helper()
	ctx := context.Background()
	d, err := db.Open(ctx, config.DB{Driver: "sqlite", Name: ":memory:"}) // pure Go, no CGO; one connection
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	// Same SQL as the migration (migrations/*_create_products.sql).
	if _, err := d.ExecContext(ctx, `CREATE TABLE products (
		id VARCHAR(26) PRIMARY KEY, owner_id VARCHAR(26) NOT NULL, name VARCHAR(120) NOT NULL,
		price_cents BIGINT NOT NULL, created_at TIMESTAMP NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	return d
}

func TestRepository(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewRepository(newTestDB(t)))
	p, err := svc.Create(ctx, "u1", CreateProductRequest{Name: "A", PriceCents: 100})
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, "u1", p.ID)
	if err != nil || got.Name != "A" || !got.CreatedAt.Equal(p.CreatedAt) {
		t.Fatalf("Get = %+v, %v (want %+v)", got, err, p)
	}
	if _, err := svc.Get(ctx, "u2", p.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("Get ajeno: err = %v, want ErrForbidden", err)
	}
	if _, err := svc.Get(ctx, "u1", "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get inexistente: err = %v, want ErrNotFound", err)
	}
	if ps, err := svc.List(ctx, "u1", 1000, -1); err != nil || len(ps) != 1 {
		t.Fatalf("List = %d, %v", len(ps), err)
	}
}
```

## Seguridad

| Riesgo | Cómo se evita |
|---|---|
| Mass assignment | DTO de entrada sin `ID`/`OwnerID`/`Role`; `DecodeJSON` rechaza campos desconocidos |
| Fuga de campos | La salida es siempre `<X>Response`, nunca el modelo |
| SQL injection | Placeholders `?` siempre; nunca `fmt.Sprintf` ni `+` con datos del usuario (solo constantes como `productColumns`) |
| Orden dinámico | `ORDER BY` desde un mapa cerrado (`map[string]string{"newest": "created_at DESC"}`), nunca el valor de la query |
| IDOR | El service compara `OwnerID`; el handler responde 404 a lo ajeno |
| Paginación | `QueryInt(r, "limit", 20, 1, MaxPage)` y `min(…, MaxPage)` en el service |
| Cuerpo | 1 MiB máximo (`MaxBytesReader`) → 413 |
| Errores | 500 sin detalles con `apphttp.ServerError`; el error real va al log con el request ID |
