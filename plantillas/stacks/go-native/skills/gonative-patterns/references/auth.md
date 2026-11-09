# Auth: JWT propio (access corto + refresh rotado)

Lo implementa el orquestador en `internal/platform/auth/` y un módulo `users` (o `auth`) con gonative-scaffold.

## 1. Dependencias (versión exacta, ≥ 14 días)

```bash
make deps-add PKGS="github.com/golang-jwt/jwt/v5@v5.3.1 golang.org/x/crypto@v0.58.0"
```

`golang.org/x/crypto` ya está en el grafo de módulos; fíjalo en la versión que muestre `go list -m golang.org/x/crypto` si es distinta.

## 2. `internal/platform/auth/auth.go`

- `HS256` fijo con `jwt.WithValidMethods`: nunca aceptes el algoritmo que diga el token (`none`, RS/HS confusion).
- Exige `exp`, `iss` y `aud`; `sub` es el id del usuario.
- El usuario viaja en el `context.Context` de la petición (`r.WithContext`): el service lo recibe sin depender de `net/http`.
- `Required` es un `apphttp.Middleware` (`func(http.Handler) http.Handler`): el handler lo recibe por constructor y lo aplica a cada ruta.

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

	"github.com/golang-jwt/jwt/v5"

	apphttp "app/internal/platform/http"
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
func Required(c Config) apphttp.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			p, err := Parse(c, raw)
			if !ok || err != nil {
				apphttp.WriteError(w, http.StatusUnauthorized, "no autenticado")
				return
			}
			next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
		})
	}
}

// RequireRole must run after Required: auth.Required(cfg)(auth.RequireRole("admin")(h)).
func RequireRole(role string) apphttp.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if p, ok := FromContext(r.Context()); !ok || p.Role != role {
				apphttp.WriteError(w, http.StatusForbidden, "prohibido")
				return
			}
			next.ServeHTTP(w, r)
		})
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

- Si el cliente es un navegador, el refresh va en cookie `HttpOnly` + `Secure` + `SameSite=Lax`: `http.SetCookie(w, &http.Cookie{Name: "refresh", Value: v, Path: "/auth", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: refreshDays * 86400})`.
- Rate limit de `/auth/login` y `/auth/refresh` en Redis (`REDIS_URL`, `internal/platform/cache`) o en el proxy.
- Variables: `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES=15`, `REFRESH_TOKEN_DAYS=14` (ya están en `.env.example`).
