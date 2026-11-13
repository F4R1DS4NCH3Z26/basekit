---
name: gin-patterns
description: "Código de referencia seguro para un módulo Go · Gin: migración SQL (goose) portable, modelo GORM (o MongoDB con mongo-driver v2: modelo con tags bson e índices declarados), DTO con binding, repositorio con context, service con interfaz definida por el consumidor, handler Gin con auth y errores traducidos, y tests con httptest y SQLite en memoria. Úsala SIEMPRE antes de escribir model, dto, repository, service, handler o tests de un módulo Go."
---

# gin-patterns

Ejemplo con el módulo `products` (paquete `app/internal/products`). Copia la forma y cambia los nombres. Busca con Grep lo que ya existe en `internal/platform/` (`auth`, `http`, `db`) antes de asumir sus nombres; la auth se crea con `references/auth.md`.

Reglas comunes:
- `context.Context` es el primer parámetro de todo lo que hace I/O; el handler pasa `c.Request.Context()`.
- La interfaz la declara quien la consume: `Repository` vive en `service.go` y `service` en `handler.go`.
- Errores envueltos con `fmt.Errorf("…: %w", err)` y comparados con `errors.Is`.
- Sin `init()` ni variables globales mutables en los módulos.

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

Con MongoDB, `make new-app` cambió el esqueleto (`gin-scaffold/scripts/mongo-setup.sh`): no hay GORM, goose ni `migrations/`; `internal/platform/db` abre `*mongo.Database` desde `MONGO_URL` (driver oficial `go.mongodb.org/mongo-driver/v2`). Cambia solo la capa de datos; DTO, service, handler y tests siguen igual, salvo el id:
- **Migraciones: no hay.** Cada módulo declara sus índices en `model.go` (`var Indexes = db.Collection{…}`) y el orquestador los lista en `collections()` de `cmd/api/main.go`. `make migrate` (`api migrate`) los crea en dev y en prod; `make dev` también al arrancar (en prod no: construir un índice sobre una colección grande la carga). `make migration` solo explica esto.
- **Nunca se borra un índice solo**: quitarlo de `Indexes` no lo quita de la BD. Para borrarlo: `make db-shell` (`ENV=prod` en producción), `db.<colección>.getIndexes()` y `db.<colección>.dropIndex('<nombre>')`.
- **Id**: `_id` es un UUID en texto; el service lo asigna con `db.NewID()` en lugar de `rand.Text()`.
- **Clave duplicada** (índice único): `db.IsDuplicateKey(err)` → el error del contrato (por ejemplo `ErrNameTaken`).

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

// Product mirrors the products table. The schema is owned by the SQL migration, not by AutoMigrate.
type Product struct {
	ID         string    `gorm:"size:26;primaryKey"`
	OwnerID    string    `gorm:"size:26;not null;index"`
	Name       string    `gorm:"size:120;not null"`
	PriceCents int64     `gorm:"not null"`
	CreatedAt  time.Time `gorm:"not null"`
}
```

## dto.go — data-writer

```go
package products

import "time"

// CreateProductRequest is the only input shape. It never carries ID, OwnerID or dates (mass assignment).
type CreateProductRequest struct {
	Name       string `json:"name" binding:"required,min=1,max=120"`
	PriceCents int64  `json:"price_cents" binding:"required,gt=0"`
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
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// GormRepository implements the Repository that service.go declares.
type GormRepository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *GormRepository {
	return &GormRepository{db: db}
}

func (r *GormRepository) Create(ctx context.Context, p *Product) error {
	if err := r.db.WithContext(ctx).Create(p).Error; err != nil {
		return fmt.Errorf("products: create: %w", err)
	}
	return nil
}

func (r *GormRepository) Get(ctx context.Context, id string) (Product, error) {
	var p Product
	err := r.db.WithContext(ctx).Where("id = ?", id).Take(&p).Error // bound parameter, never Sprintf
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Product{}, ErrNotFound
	}
	if err != nil {
		return Product{}, fmt.Errorf("products: get: %w", err)
	}
	return p, nil
}

func (r *GormRepository) ListByOwner(ctx context.Context, ownerID string, limit, offset int) ([]Product, error) {
	var out []Product
	err := r.db.WithContext(ctx).
		Where("owner_id = ?", ownerID).
		Order("created_at DESC").Limit(limit).Offset(offset).
		Find(&out).Error
	if err != nil {
		return nil, fmt.Errorf("products: list: %w", err)
	}
	return out, nil
}
```

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

// Repository is what the service needs; GormRepository implements it and tests fake it.
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
		CreatedAt:  s.now().UTC(),
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

	"github.com/gin-gonic/gin"

	"app/internal/platform/auth"
)

// service is what the handler needs from *Service (the consumer defines the interface).
type service interface {
	Create(ctx context.Context, ownerID string, in CreateProductRequest) (Product, error)
	Get(ctx context.Context, userID, id string) (Product, error)
	List(ctx context.Context, userID string, limit, offset int) ([]Product, error)
}

type Handler struct {
	svc   service
	authn gin.HandlerFunc
}

// NewHandler receives the auth middleware (auth.Required in main, a fake in tests).
func NewHandler(svc service, authn gin.HandlerFunc) *Handler {
	return &Handler{svc: svc, authn: authn}
}

func (h *Handler) Register(r gin.IRouter) {
	g := r.Group("/products", h.authn)
	g.POST("", h.create)
	g.GET("", h.list)
	g.GET("/:id", h.get)
}

type listQuery struct {
	Limit  int `form:"limit,default=20" binding:"min=1,max=100"`
	Offset int `form:"offset,default=0" binding:"min=0"`
}

func (h *Handler) create(c *gin.Context) {
	user, _ := auth.FromContext(c.Request.Context())
	var in CreateProductRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "entrada inválida"}) // never echo the input
		return
	}
	p, err := h.svc.Create(c.Request.Context(), user.ID, in)
	if err != nil {
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error interno"})
		return
	}
	c.JSON(http.StatusCreated, toProductResponse(p))
}

func (h *Handler) list(c *gin.Context) {
	user, _ := auth.FromContext(c.Request.Context())
	var q listQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "parámetros inválidos"})
		return
	}
	ps, err := h.svc.List(c.Request.Context(), user.ID, q.Limit, q.Offset)
	if err != nil {
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error interno"})
		return
	}
	out := make([]ProductResponse, 0, len(ps))
	for _, p := range ps {
		out = append(out, toProductResponse(p))
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) get(c *gin.Context) {
	user, _ := auth.FromContext(c.Request.Context())
	p, err := h.svc.Get(c.Request.Context(), user.ID, c.Param("id"))
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrForbidden):
		// 404 for someone else's product too: never reveal that it exists
		c.JSON(http.StatusNotFound, gin.H{"error": "no encontrado"})
	case err != nil:
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error interno"})
	default:
		c.JSON(http.StatusOK, toProductResponse(p))
	}
}
```

Registro (orquestador, `cmd/api/main.go`):

```go
modules := []apphttp.Registrar{
	products.NewHandler(products.NewService(products.NewRepository(gdb)), auth.Required(authCfg)),
}
```

`platform/http` activa `binding.EnableDecoderDisallowUnknownFields`: un campo extra en el JSON falla el binding (→ 422).

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

	"github.com/gin-gonic/gin"

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
func as(userID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
			return
		}
		c.Request = c.Request.WithContext(auth.WithPrincipal(c.Request.Context(), auth.Principal{ID: userID}))
		c.Next()
	}
}

func TestHandler(t *testing.T) {
	svc := &fakeService{products: map[string]Product{"other": {ID: "other", OwnerID: "u2"}}}
	tests := []struct {
		name, user, method, path, body string
		want                           int
	}{
		{"sin auth es 401", "", http.MethodPost, "/products", `{"name":"A","price_cents":100}`, http.StatusUnauthorized},
		{"caso feliz es 201", "u1", http.MethodPost, "/products", `{"name":"A","price_cents":100}`, http.StatusCreated},
		{"campo extra es 422", "u1", http.MethodPost, "/products", `{"name":"A","price_cents":100,"owner_id":"x"}`, http.StatusUnprocessableEntity},
		{"input inválido es 422", "u1", http.MethodPost, "/products", `{"name":"","price_cents":0}`, http.StatusUnprocessableEntity},
		{"producto ajeno es 404", "u1", http.MethodGet, "/products/other", "", http.StatusNotFound},
		{"limit fuera de rango es 422", "u1", http.MethodGet, "/products?limit=1000", "", http.StatusUnprocessableEntity},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := apphttp.NewRouter(apphttp.Options{Release: true}, NewHandler(svc, as(tt.user)))
			w := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)
			if w.Code != tt.want {
				t.Fatalf("%s %s = %d, want %d (%s)", tt.method, tt.path, w.Code, tt.want, w.Body)
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

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1) // one connection = one in-memory database
	t.Cleanup(func() { _ = sqlDB.Close() })
	// Same SQL as the migration (migrations/*_create_products.sql).
	if err := db.Exec(`CREATE TABLE products (
		id VARCHAR(26) PRIMARY KEY, owner_id VARCHAR(26) NOT NULL, name VARCHAR(120) NOT NULL,
		price_cents BIGINT NOT NULL, created_at TIMESTAMP NOT NULL)`).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestRepository(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewRepository(newTestDB(t)))
	p, err := svc.Create(ctx, "u1", CreateProductRequest{Name: "A", PriceCents: 100})
	if err != nil {
		t.Fatal(err)
	}
	if got, err := svc.Get(ctx, "u1", p.ID); err != nil || got.Name != "A" {
		t.Fatalf("Get = %+v, %v", got, err)
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
| Mass assignment | DTO de entrada sin `ID`/`OwnerID`/`Role`; campos desconocidos rechazados |
| Fuga de campos | La salida es siempre `<X>Response`, nunca el modelo |
| SQL injection | GORM con `?`; nunca `fmt.Sprintf` en `Where`, `Order` ni `Raw` con datos del usuario |
| IDOR | El service compara `OwnerID`; el handler responde 404 a lo ajeno |
| Paginación | `max=100` en el binding y `min(…, MaxPage)` en el service |
| Errores | 500 sin detalles; el error real va a `c.Error(err)` y al log |
