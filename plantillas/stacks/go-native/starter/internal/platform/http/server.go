// Package http is the whole web layer, on the standard library only: a ServeMux with Go 1.22+
// method and path patterns ("GET /items/{id}"), hand-written middleware (request ID, recover,
// access log with slog, body limit, CORS), JSON helpers and a server with graceful shutdown.
// Modules register their routes through a Registrar.
package http

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	nethttp "net/http"
	"time"
)

// MaxBodyBytes caps every request body (1 MiB); DecodeJSON answers 413 beyond it.
const MaxBodyBytes = 1 << 20

// Registrar is implemented by each module's Handler: it adds its routes to the mux.
type Registrar interface {
	Register(mux *nethttp.ServeMux)
}

// Middleware wraps a handler (auth.Required, a fake in tests…).
type Middleware func(nethttp.Handler) nethttp.Handler

// Options configures the router.
type Options struct {
	CORSOrigins []string
	Logger      *slog.Logger
}

// NewRouter returns the root handler: /health, every module and the middleware chain.
// The outermost middleware runs first.
func NewRouter(o Options, modules ...Registrar) nethttp.Handler {
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	mux := nethttp.NewServeMux()
	mux.HandleFunc("GET /health", func(w nethttp.ResponseWriter, _ *nethttp.Request) {
		WriteJSON(w, nethttp.StatusOK, map[string]string{"status": "ok"})
	})
	for _, m := range modules {
		m.Register(mux)
	}
	return chain(jsonFallback(mux),
		requestID,
		limitBody,
		accessLog(o.Logger),
		recoverPanics(o.Logger),
		cors(o.CORSOrigins),
	)
}

// chain applies mws so that mws[0] is the outermost.
func chain(h nethttp.Handler, mws ...Middleware) nethttp.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// jsonFallback serves the mux, but answers its own 404 and 405 (plain text by default) as JSON.
// A 405 keeps the Allow header the mux computed from the registered patterns.
func jsonFallback(mux *nethttp.ServeMux) nethttp.Handler {
	return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
		h, pattern := mux.Handler(r)
		if pattern != "" { // a route (or a redirect) matched
			mux.ServeHTTP(w, r)
			return
		}
		probe := &statusProbe{header: w.Header()}
		h.ServeHTTP(probe, r)
		if probe.code == nethttp.StatusMethodNotAllowed {
			WriteError(w, nethttp.StatusMethodNotAllowed, "método no permitido")
			return
		}
		WriteError(w, nethttp.StatusNotFound, "no encontrado")
	})
}

// statusProbe records the status of the mux's fallback handler and drops its text body.
type statusProbe struct {
	header nethttp.Header
	code   int
}

func (p *statusProbe) Header() nethttp.Header      { return p.header }
func (p *statusProbe) Write(b []byte) (int, error) { return len(b), nil }
func (p *statusProbe) WriteHeader(code int)        { p.code = code }

// Run serves h on addr until ctx is cancelled (SIGTERM), then drains requests for up to 10 s.
func Run(ctx context.Context, addr string, h nethttp.Handler, log *slog.Logger) error {
	srv := &nethttp.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
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
