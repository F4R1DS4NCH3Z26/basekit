// Command api is the only binary of the project:
//
//	api [serve]                   HTTP server (default)
//	api migrate [up|down|status]  versioned migrations (the compose migrate service)
//	api migration <name>          creates migrations/<timestamp>_<name>.sql (make migration NAME=x)
//	api healthcheck               GET /health; exit 0/1 (the prod image has no shell or curl)
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	nethttp "net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"app/internal/platform/cache"
	"app/internal/platform/config"
	"app/internal/platform/db"
	apphttp "app/internal/platform/http"
	"app/migrations"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	cmd := "serve"
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "serve":
		return serve(ctx)
	case "migrate":
		return migrate(ctx, args)
	case "migration":
		if len(args) != 1 {
			return errors.New("uso: api migration <nombre_snake_case>")
		}
		path, err := db.CreateMigration("migrations", args[0])
		if err != nil {
			return err
		}
		fmt.Println("creada:", path)
		return nil
	case "healthcheck":
		return healthcheck(ctx)
	default:
		return fmt.Errorf("comando %q desconocido (serve, migrate, migration o healthcheck)", cmd)
	}
}

func serve(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := newLogger(cfg)
	database, err := openDB(ctx, cfg)
	if err != nil {
		return err
	}
	if database != nil {
		defer func() { _ = database.Close() }()
	}
	rdb, err := cache.Open(ctx, cfg.RedisURL)
	switch {
	case errors.Is(err, cache.ErrDisabled):
	case err != nil:
		return err
	default:
		defer func() { _ = rdb.Close() }()
	}

	// Modules (orchestrator): build each one from its constructors and list its Handler here, e.g.
	//   orders.NewHandler(orders.NewService(orders.NewRepository(database)), auth.Required(authCfg)),
	// (internal/platform/auth comes from the gonative-patterns skill, references/auth.md).
	modules := []apphttp.Registrar{}

	router := apphttp.NewRouter(apphttp.Options{CORSOrigins: cfg.CORSOrigins, Logger: log}, modules...)
	return apphttp.Run(ctx, cfg.Addr, router, log)
}

// openDB returns nil (and no error) when no database overlay is active: the API runs with /health only.
func openDB(ctx context.Context, cfg config.Config) (*db.DB, error) {
	database, err := db.Open(ctx, cfg.DB)
	if errors.Is(err, db.ErrDisabled) {
		return nil, nil
	}
	return database, err
}

func migrate(ctx context.Context, args []string) error {
	command := "up"
	if len(args) > 0 {
		command = args[0]
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.DB.Enabled() {
		fmt.Println("migrate: sin base de datos configurada (skill infra-setup); nada que aplicar")
		return nil
	}
	database, err := db.Open(ctx, cfg.DB)
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()
	return db.Migrate(ctx, database.Pool(), cfg.DB.Driver, migrations.FS, command, os.Stdout)
}

func healthcheck(ctx context.Context) error {
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := nethttp.NewRequestWithContext(ctx, nethttp.MethodGet, "http://"+addr+"/health", nil)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	res, err := nethttp.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != nethttp.StatusOK {
		return fmt.Errorf("healthcheck: /health respondió %d", res.StatusCode)
	}
	return nil
}

func newLogger(cfg config.Config) *slog.Logger {
	var h slog.Handler = slog.NewTextHandler(os.Stdout, nil)
	if cfg.Env == "prod" {
		h = slog.NewJSONHandler(os.Stdout, nil)
	}
	log := slog.New(h)
	slog.SetDefault(log)
	return log
}
