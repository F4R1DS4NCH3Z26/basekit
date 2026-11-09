package http

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	nethttp "net/http"
	"strconv"
)

// Validator is implemented by input DTOs (Create<X>Request.Validate). DecodeJSON calls it.
type Validator interface {
	Validate() error
}

// WriteJSON writes v as JSON with the given status.
func WriteJSON(w nethttp.ResponseWriter, status int, v any) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("http: write json", "error", err)
	}
}

// WriteError writes {"error": msg}. msg is a fixed text: never the user's input or an internal error.
func WriteError(w nethttp.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{"error": msg})
}

// ServerError logs err with the route and request ID and answers 500 without details.
func ServerError(w nethttp.ResponseWriter, r *nethttp.Request, err error) {
	slog.ErrorContext(r.Context(), "http: error interno", "route", r.Pattern, "error", err,
		"request_id", RequestID(r.Context()))
	WriteError(w, nethttp.StatusInternalServerError, "error interno")
}

// DecodeJSON reads exactly one JSON object into dst and validates it. On failure it writes the
// response itself and returns false: 413 if the body is over MaxBodyBytes, 422 for malformed JSON,
// unknown fields (mass assignment), trailing data or a failed Validate.
func DecodeJSON(w nethttp.ResponseWriter, r *nethttp.Request, dst any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	err := dec.Decode(dst)
	if err == nil {
		if err = dec.Decode(&json.RawMessage{}); errors.Is(err, io.EOF) {
			err = nil
		} else if err == nil {
			err = errors.New("datos después del objeto JSON")
		}
	}
	if err == nil {
		if v, ok := dst.(Validator); ok {
			err = v.Validate()
		}
	}
	if err == nil {
		return true
	}
	if _, ok := errors.AsType[*nethttp.MaxBytesError](err); ok {
		WriteError(w, nethttp.StatusRequestEntityTooLarge, "cuerpo demasiado grande")
		return false
	}
	WriteError(w, nethttp.StatusUnprocessableEntity, "entrada inválida") // never echo the input
	return false
}

// QueryInt reads an optional integer query parameter within [lo, hi]; a missing key gives def.
// Out of range or not a number is an error (the handler answers 422).
func QueryInt(r *nethttp.Request, key string, def, lo, hi int) (int, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < lo || n > hi {
		return 0, errors.New("parámetro " + key + " fuera de rango")
	}
	return n, nil
}
