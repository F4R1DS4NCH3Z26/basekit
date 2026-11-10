# Auth: JWT propio (access corto + refresh rotado)

Lo implementa el orquestador en `internal/platform/auth/` y un módulo `users` (o `auth`) con gin-scaffold.

## 1. Dependencias (versión exacta, ≥ 14 días)

```bash
make deps-add PKGS="github.com/golang-jwt/jwt/v5@v5.3.1 golang.org/x/crypto@v0.58.0"
```

`golang.org/x/crypto` ya está en el grafo de módulos; fíjalo en la versión que muestre `go list -m golang.org/x/crypto` si es distinta.

## 2. `internal/platform/auth/auth.go`

- `HS256` fijo con `jwt.WithValidMethods`: nunca aceptes el algoritmo que diga el token (`none`, RS/HS confusion).
- Exige `exp`, `iss` y `aud`; `sub` es el id del usuario.
- El usuario viaja en el `context.Context` de la petición, no en `gin.Context.Set`: así el service lo puede recibir sin depender de Gin.

```go
// Package auth validates access tokens (JWT HS256) and carries the user in the request context.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type ctxKey struct{}

// Principal is the authenticated user the handlers see.
type Principal struct {
	ID   string
	Role string
}

// WithPrincipal returns a context carrying p (the middleware and the tests use it).
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// FromContext returns the authenticated user, if any.
func FromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(ctxKey{}).(Principal)
	return p, ok
}

// Config comes from JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE and ACCESS_TOKEN_MINUTES.
type Config struct {
	Secret    []byte
	Issuer    string
	Audience  string
	AccessTTL time.Duration
}

type claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

// Issue signs an access token for userID.
func Issue(c Config, userID, role string, now time.Time) (string, error) {
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{Role: role, RegisteredClaims: jwt.RegisteredClaims{
		Subject:   userID,
		Issuer:    c.Issuer,
		Audience:  jwt.ClaimStrings{c.Audience},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(c.AccessTTL)),
	}})
	s, err := t.SignedString(c.Secret)
	if err != nil {
		return "", fmt.Errorf("auth: sign: %w", err)
	}
	return s, nil
}

// Parse validates signature, algorithm, exp, iss and aud.
func Parse(c Config, token string) (Principal, error) {
	var cl claims
	_, err := jwt.ParseWithClaims(token, &cl, func(*jwt.Token) (any, error) { return c.Secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(c.Issuer), jwt.WithAudience(c.Audience),
		jwt.WithExpirationRequired(), jwt.WithLeeway(30*time.Second))
	if err != nil {
		return Principal{}, fmt.Errorf("auth: %w", err)
	}
	if cl.Subject == "" {
		return Principal{}, errors.New("auth: token sin sub")
	}
	return Principal{ID: cl.Subject, Role: cl.Role}, nil
}

// Required rejects the request with 401 unless it carries a valid Bearer token.
func Required(c Config) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		raw, ok := strings.CutPrefix(ctx.GetHeader("Authorization"), "Bearer ")
		p, err := Parse(c, raw)
		if !ok || err != nil {
			ctx.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
			return
		}
		ctx.Request = ctx.Request.WithContext(WithPrincipal(ctx.Request.Context(), p))
		ctx.Next()
	}
}

// RequireRole must run after Required.
func RequireRole(role string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		if p, ok := FromContext(ctx.Request.Context()); !ok || p.Role != role {
			ctx.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "prohibido"})
			return
		}
		ctx.Next()
	}
}
```

Configuración en `cmd/api/main.go` (léela de `config.Load()` si prefieres):

```go
ttl, _ := strconv.Atoi(os.Getenv("ACCESS_TOKEN_MINUTES"))
authCfg := auth.Config{
	Secret:    []byte(os.Getenv("JWT_SECRET")), // __GENERATE__ en .env.example: 64 hex
	Issuer:    os.Getenv("JWT_ISSUER"),
	Audience:  os.Getenv("JWT_AUDIENCE"),
	AccessTTL: time.Duration(max(ttl, 1)) * time.Minute,
}
if len(authCfg.Secret) < 32 {
	return errors.New("JWT_SECRET debe tener al menos 32 bytes")
}
```

## 3. Contraseñas (argon2id)

```go
import "golang.org/x/crypto/argon2"

// Hash: sal aleatoria de 16 bytes; guarda sal + hash + parámetros (formato PHC: $argon2id$v=19$m=65536,t=3,p=2$…).
key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
// Verificación: recalcula con los parámetros guardados y compara con subtle.ConstantTimeCompare.
```

- Un `dummyHash` precalculado: si el usuario no existe, verifica contra él igual, para que el login tarde lo mismo.
- Mensaje único `credenciales inválidas` (no reveles si el email existe).

## 4. Módulo `users`

- Tablas `users` (`id`, `email` único, `password_hash`, `role`, `created_at`) y `refresh_tokens` (`id`, `user_id`, `token_hash`, `family_id`, `expires_at`, `revoked_at`).
- El refresh es un valor aleatorio (`rand.Text()`); en la BD solo guardas su SHA-256.
- `Rotate`: si llega un refresh ya rotado o revocado, revoca toda la familia (robo detectado).
- Endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.
- `role` nunca viene del body del registro.

## 5. Navegador y abuso

- Si el cliente es un navegador, el refresh va en cookie `HttpOnly` + `Secure` + `SameSite=Lax` (`c.SetSameSite(http.SameSiteLaxMode)` antes de `c.SetCookie`).
- Rate limit de `/auth/login` y `/auth/refresh` en Redis (`REDIS_URL`, `internal/platform/cache`) o en el proxy.
- Variables: `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES=15`, `REFRESH_TOKEN_DAYS=14` (ya están en `.env.example`).
