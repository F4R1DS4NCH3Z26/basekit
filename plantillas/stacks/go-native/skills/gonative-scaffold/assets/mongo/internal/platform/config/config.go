// Package config reads the process configuration from the environment (Compose injects it).
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

// Config is the whole runtime configuration. It is read once in main and passed down.
type Config struct {
	Env         string // dev | prod
	Addr        string // listen address inside the container
	CORSOrigins []string
	DB          DB
	RedisURL    string
}

// DB holds the connection variables the MongoDB overlay of infra-setup injects (compose.db.yaml).
type DB struct {
	Driver string // mongodb; empty means no database
	URL    string // MONGO_URL, with the app user; the database is the one in its path
}

// Enabled reports whether a database overlay is active.
func (d DB) Enabled() bool { return d.Driver != "" }

// Load reads the environment and validates it.
func Load() (Config, error) {
	c := Config{
		Env:         getenv("APP_ENV", "dev"),
		Addr:        getenv("HTTP_ADDR", ":8080"),
		CORSOrigins: splitList(os.Getenv("CORS_ORIGINS")),
		RedisURL:    os.Getenv("REDIS_URL"),
		DB: DB{
			Driver: os.Getenv("DB_DRIVER"),
			URL:    os.Getenv("MONGO_URL"),
		},
	}
	switch c.DB.Driver {
	case "":
	case "mongodb":
		if c.DB.URL == "" {
			return Config{}, errors.New("config: MONGO_URL no está definida (activa MongoDB con la skill infra-setup y make env)")
		}
	default:
		return Config{}, fmt.Errorf("config: DB_DRIVER %q no soportado (este proyecto usa MongoDB: mongodb)", c.DB.Driver)
	}
	if c.Env != "dev" && c.Env != "prod" {
		return Config{}, fmt.Errorf("config: APP_ENV %q debe ser dev o prod", c.Env)
	}
	return c, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
