// Package config reads the process configuration from the environment (Compose injects it).
package config

import (
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

// DB holds the connection variables the infra-setup overlays inject (compose.db.yaml).
type DB struct {
	Driver   string // postgres | mysql | sqlite; empty means no database
	URL      string // DATABASE_URL
	Host     string
	Port     string
	Name     string // for sqlite, the file path (/app/data/app.db)
	User     string
	Password string
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
			Driver:   os.Getenv("DB_DRIVER"),
			URL:      os.Getenv("DATABASE_URL"),
			Host:     os.Getenv("DB_HOST"),
			Port:     os.Getenv("DB_PORT"),
			Name:     os.Getenv("DB_DATABASE"),
			User:     os.Getenv("DB_USERNAME"),
			Password: os.Getenv("DB_PASSWORD"),
		},
	}
	switch c.DB.Driver {
	case "", "postgres", "mysql", "sqlite":
	default:
		return Config{}, fmt.Errorf("config: DB_DRIVER %q no soportado (postgres, mysql o sqlite)", c.DB.Driver)
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
