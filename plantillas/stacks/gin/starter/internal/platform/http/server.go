// Package http builds the Gin engine (middleware, /health, JSON errors) and runs the server
// with graceful shutdown. Modules register their routes through a Registrar.
package http

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	nethttp "net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

// MaxBodyBytes caps every request body (1 MiB).
const MaxBodyBytes = 1 << 20

// Registrar is implemented by each module's Handler: it mounts its routes under the API group.
type Registrar interface {
	Register(r gin.IRouter)
}

// Options configures the engine.
type Options struct {
	Release     bool
	CORSOrigins []string
	Logger      *slog.Logger
}

func init() {
	// Unknown JSON fields are rejected: a client cannot smuggle owner_id, role… (mass assignment).
	binding.EnableDecoderDisallowUnknownFields = true
}

// NewRouter returns the engine with /health and every module mounted at the root.
func NewRouter(o Options, modules ...Registrar) *gin.Engine {
	if o.Release {
		gin.SetMode(gin.ReleaseMode)
	}
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	r := gin.New()
	r.HandleMethodNotAllowed = true
	_ = r.SetTrustedProxies(nil) // c.ClientIP() is the socket peer unless you trust your proxy explicitly
	r.Use(accessLog(o.Logger), gin.CustomRecovery(recovery(o.Logger)), limitBody, cors(o.CORSOrigins))
	r.NoRoute(func(c *gin.Context) { c.JSON(nethttp.StatusNotFound, gin.H{"error": "no encontrado"}) })
	r.NoMethod(func(c *gin.Context) { c.JSON(nethttp.StatusMethodNotAllowed, gin.H{"error": "método no permitido"}) })
	r.GET("/health", func(c *gin.Context) { c.JSON(nethttp.StatusOK, gin.H{"status": "ok"}) })
	for _, m := range modules {
		m.Register(r)
	}
	return r
}

// Run serves h on addr until ctx is cancelled (SIGTERM), then drains requests for up to 10 s.
func Run(ctx context.Context, addr string, h nethttp.Handler, log *slog.Logger) error {
	srv := &nethttp.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("http: escuchando", "addr", addr)
		errc <- srv.ListenAndServe()
	}()
	select {
	case err := <-errc:
		return fmt.Errorf("http: %w", err)
	case <-ctx.Done():
	}
	log.Info("http: apagando")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("http: shutdown: %w", err)
	}
	if err := <-errc; err != nil && !errors.Is(err, nethttp.ErrServerClosed) {
		return fmt.Errorf("http: %w", err)
	}
	return nil
}

func accessLog(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		if c.FullPath() == "/health" {
			return
		}
		log.Info("http", "method", c.Request.Method, "route", c.FullPath(), "status", c.Writer.Status(),
			"ms", time.Since(start).Milliseconds())
	}
}

func recovery(log *slog.Logger) gin.RecoveryFunc {
	return func(c *gin.Context, err any) {
		log.Error("http: panic", "route", c.FullPath(), "error", err)
		c.AbortWithStatusJSON(nethttp.StatusInternalServerError, gin.H{"error": "error interno"})
	}
}

func limitBody(c *gin.Context) {
	if c.Request.Body != nil {
		c.Request.Body = nethttp.MaxBytesReader(c.Writer, c.Request.Body, MaxBodyBytes)
	}
	c.Next()
}

// cors allows only the explicit origins of CORS_ORIGINS (never "*" with credentials).
func cors(origins []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" || !slices.Contains(origins, origin) {
			c.Next()
			return
		}
		h := c.Writer.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Add("Vary", "Origin")
		if c.Request.Method == nethttp.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			h.Set("Access-Control-Max-Age", "600")
			c.AbortWithStatus(nethttp.StatusNoContent)
			return
		}
		c.Next()
	}
}
