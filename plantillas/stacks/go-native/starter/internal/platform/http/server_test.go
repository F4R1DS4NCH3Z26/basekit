package http

import (
	"errors"
	"io"
	"log/slog"
	nethttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// echo is a tiny module for the tests: GET/POST /echo/{id} and a route that panics.
type echo struct{}

type echoIn struct {
	Name string `json:"name"`
}

func (e echoIn) Validate() error {
	if e.Name == "" {
		return errors.New("name: obligatorio")
	}
	return nil
}

func (echo) Register(mux *nethttp.ServeMux) {
	mux.HandleFunc("GET /echo/{id}", func(w nethttp.ResponseWriter, r *nethttp.Request) {
		WriteJSON(w, nethttp.StatusOK, map[string]string{"id": r.PathValue("id")})
	})
	mux.HandleFunc("POST /echo", func(w nethttp.ResponseWriter, r *nethttp.Request) {
		var in echoIn
		if !DecodeJSON(w, r, &in) {
			return
		}
		WriteJSON(w, nethttp.StatusCreated, in)
	})
	mux.HandleFunc("GET /boom", func(nethttp.ResponseWriter, *nethttp.Request) { panic("boom") })
}

func serve(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := NewRouter(Options{Logger: quiet, CORSOrigins: []string{"http://ok.test"}}, echo{})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestRoutes(t *testing.T) {
	big := `{"name":"` + strings.Repeat("a", MaxBodyBytes) + `"}`
	tests := []struct {
		name, method, path, body string
		want                     int
		contains                 string
	}{
		{"health", nethttp.MethodGet, "/health", "", nethttp.StatusOK, `"ok"`},
		{"path value", nethttp.MethodGet, "/echo/42", "", nethttp.StatusOK, `"42"`},
		{"ruta desconocida es 404 JSON", nethttp.MethodGet, "/nope", "", nethttp.StatusNotFound, `"error"`},
		{"método equivocado es 405 JSON", nethttp.MethodDelete, "/echo/42", "", nethttp.StatusMethodNotAllowed, `"error"`},
		{"caso feliz es 201", nethttp.MethodPost, "/echo", `{"name":"a"}`, nethttp.StatusCreated, `"a"`},
		{"campo extra es 422", nethttp.MethodPost, "/echo", `{"name":"a","role":"admin"}`, nethttp.StatusUnprocessableEntity, `"error"`},
		{"JSON roto es 422", nethttp.MethodPost, "/echo", `{"name":`, nethttp.StatusUnprocessableEntity, `"error"`},
		{"dos objetos es 422", nethttp.MethodPost, "/echo", `{"name":"a"}{}`, nethttp.StatusUnprocessableEntity, `"error"`},
		{"Validate falla es 422", nethttp.MethodPost, "/echo", `{"name":""}`, nethttp.StatusUnprocessableEntity, `"error"`},
		{"cuerpo grande es 413", nethttp.MethodPost, "/echo", big, nethttp.StatusRequestEntityTooLarge, `"error"`},
		{"pánico es 500 sin detalles", nethttp.MethodGet, "/boom", "", nethttp.StatusInternalServerError, `"error interno"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := serve(t, tt.method, tt.path, tt.body)
			if w.Code != tt.want || !strings.Contains(w.Body.String(), tt.contains) {
				t.Fatalf("%s %s = %d %.200s, want %d with %s", tt.method, tt.path, w.Code, w.Body, tt.want, tt.contains)
			}
			if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
				t.Fatalf("Content-Type = %q, want JSON", ct)
			}
			if strings.Contains(w.Body.String(), "boom") {
				t.Fatalf("la respuesta filtra el pánico: %s", w.Body)
			}
		})
	}
}

func TestMethodNotAllowedKeepsAllow(t *testing.T) {
	w := serve(t, nethttp.MethodDelete, "/echo/42", "")
	if allow := w.Header().Get("Allow"); !strings.Contains(allow, "GET") {
		t.Fatalf("Allow = %q, want GET", allow)
	}
}

func TestRequestID(t *testing.T) {
	r := NewRouter(Options{Logger: quiet})
	for in, keep := range map[string]bool{"abc-123": true, "bad id\n": false, "": false} {
		req := httptest.NewRequest(nethttp.MethodGet, "/health", nil)
		req.Header.Set("X-Request-ID", in)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		got := w.Header().Get("X-Request-ID")
		if got == "" || (got == in) != keep {
			t.Errorf("X-Request-ID %q → %q (keep=%v)", in, got, keep)
		}
	}
}

func TestCORSOnlyAllowsListedOrigins(t *testing.T) {
	r := NewRouter(Options{Logger: quiet, CORSOrigins: []string{"http://ok.test"}})
	for origin, want := range map[string]string{"http://ok.test": "http://ok.test", "http://evil.test": ""} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(nethttp.MethodGet, "/health", nil)
		req.Header.Set("Origin", origin)
		r.ServeHTTP(w, req)
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != want {
			t.Errorf("origin %s: Allow-Origin = %q, want %q", origin, got, want)
		}
	}
}

func TestQueryInt(t *testing.T) {
	for q, want := range map[string]int{"": 20, "?limit=5": 5, "?limit=0": -1, "?limit=101": -1, "?limit=x": -1} {
		got, err := QueryInt(httptest.NewRequest(nethttp.MethodGet, "/"+q, nil), "limit", 20, 1, 100)
		if (want == -1) != (err != nil) || (err == nil && got != want) {
			t.Errorf("QueryInt(%q) = %d, %v; want %d", q, got, err, want)
		}
	}
}
