package http

import (
	nethttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestHealth(t *testing.T) {
	r := NewRouter(Options{Release: true})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(nethttp.MethodGet, "/health", nil))
	if w.Code != nethttp.StatusOK || !strings.Contains(w.Body.String(), `"ok"`) {
		t.Fatalf("GET /health = %d %s", w.Code, w.Body)
	}
}

func TestUnknownRouteIsJSON404(t *testing.T) {
	r := NewRouter(Options{Release: true})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(nethttp.MethodGet, "/nope", nil))
	if w.Code != nethttp.StatusNotFound || !strings.Contains(w.Body.String(), `"error"`) {
		t.Fatalf("GET /nope = %d %s", w.Code, w.Body)
	}
}

func TestCORSOnlyAllowsListedOrigins(t *testing.T) {
	r := NewRouter(Options{Release: true, CORSOrigins: []string{"http://ok.test"}})
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

func init() { gin.SetMode(gin.TestMode) }
