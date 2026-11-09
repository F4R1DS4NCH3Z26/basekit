package http

import (
	"context"
	"crypto/rand"
	"errors"
	"log/slog"
	nethttp "net/http"
	"regexp"
	"slices"
	"time"
)

type requestIDKey struct{}

// validRequestID accepts a caller's X-Request-ID only if it is short and safe to log.
var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// RequestID returns the ID of the current request ("" outside a request).
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// requestID reuses a valid X-Request-ID from the proxy or creates one, and echoes it in the response.
func requestID(next nethttp.Handler) nethttp.Handler {
	return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
		id := r.Header.Get("X-Request-ID")
		if !validRequestID.MatchString(id) {
			id = rand.Text()
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

// limitBody caps the body; reading past MaxBodyBytes fails with *http.MaxBytesError (DecodeJSON → 413).
// It gets the server's ResponseWriter, so the connection is closed after an oversized body.
func limitBody(next nethttp.Handler) nethttp.Handler {
	return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
		if r.Body != nil {
			r = r.WithContext(r.Context()) // shallow copy: a handler never modifies the request it got
			r.Body = nethttp.MaxBytesReader(w, r.Body, MaxBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

// statusWriter remembers the status code for the access log and recoverPanics.
type statusWriter struct {
	nethttp.ResponseWriter
	code  int
	wrote bool
}

func (s *statusWriter) WriteHeader(code int) {
	if !s.wrote {
		s.code, s.wrote = code, true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if !s.wrote {
		s.code, s.wrote = nethttp.StatusOK, true
	}
	return s.ResponseWriter.Write(b)
}

// Unwrap lets http.ResponseController reach the real writer (Flush, deadlines).
func (s *statusWriter) Unwrap() nethttp.ResponseWriter { return s.ResponseWriter }

// accessLog writes one slog line per request with the matched pattern (never the raw path,
// which may carry IDs or tokens). /health is not logged.
// Middleware between accessLog and the mux must not copy the request: the mux sets r.Pattern on it.
func accessLog(log *slog.Logger) Middleware {
	return func(next nethttp.Handler) nethttp.Handler {
		return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w, code: nethttp.StatusOK}
			next.ServeHTTP(sw, r)
			if r.Pattern == "GET /health" {
				return
			}
			route := r.Pattern
			if route == "" {
				route = "-" // 404 or 405
			}
			log.Info("http", "method", r.Method, "route", route, "status", sw.code,
				"ms", time.Since(start).Milliseconds(), "request_id", RequestID(r.Context()))
		})
	}
}

// recoverPanics turns a panic into a JSON 500 without details; the panic goes to the log.
func recoverPanics(log *slog.Logger) Middleware {
	return func(next nethttp.Handler) nethttp.Handler {
		return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				if err, ok := rec.(error); ok && errors.Is(err, nethttp.ErrAbortHandler) {
					panic(rec) // the server's way to abort a response: let it through
				}
				log.Error("http: panic", "route", r.Pattern, "error", rec, "request_id", RequestID(r.Context()))
				if sw, ok := w.(*statusWriter); ok && sw.wrote {
					return // the response already started: nothing safe to add
				}
				WriteError(w, nethttp.StatusInternalServerError, "error interno")
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// cors allows only the explicit origins of CORS_ORIGINS (never "*" with credentials).
func cors(origins []string) Middleware {
	return func(next nethttp.Handler) nethttp.Handler {
		return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" || !slices.Contains(origins, origin) {
				next.ServeHTTP(w, r)
				return
			}
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Add("Vary", "Origin")
			if r.Method == nethttp.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE")
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				h.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(nethttp.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
