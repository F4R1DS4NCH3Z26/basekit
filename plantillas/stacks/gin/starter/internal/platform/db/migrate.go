package db

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"text/template"

	"github.com/pressly/goose/v3"
	"gorm.io/gorm"
)

var dialects = map[string]goose.Dialect{
	"postgres": goose.DialectPostgres,
	"mysql":    goose.DialectMySQL,
	"sqlite":   goose.DialectSQLite3,
}

// Migrate runs a goose command (up, down or status) over the embedded migrations.
func Migrate(ctx context.Context, gdb *gorm.DB, driver string, migrations fs.FS, command string, out io.Writer) error {
	dialect, ok := dialects[driver]
	if !ok {
		return fmt.Errorf("migrate: driver %q no soportado", driver)
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return fmt.Errorf("migrate: pool: %w", err)
	}
	p, err := goose.NewProvider(dialect, sqlDB, migrations)
	if errors.Is(err, goose.ErrNoMigrations) {
		_, _ = fmt.Fprintln(out, "migrate: no hay migraciones todavía (make migration NAME=x)")
		return nil
	}
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	switch command {
	case "up":
		results, err := p.Up(ctx)
		for _, r := range results {
			_, _ = fmt.Fprintf(out, "migrate: %s %s (%s)\n", r.Direction, r.Source.Path, r.Duration)
		}
		if err != nil {
			return fmt.Errorf("migrate up: %w", err)
		}
		if len(results) == 0 {
			_, _ = fmt.Fprintln(out, "migrate: al día")
		}
	case "down":
		r, err := p.Down(ctx)
		if errors.Is(err, goose.ErrNoNextVersion) {
			_, _ = fmt.Fprintln(out, "migrate: no hay nada que revertir")
			return nil
		}
		if err != nil {
			return fmt.Errorf("migrate down: %w", err)
		}
		_, _ = fmt.Fprintf(out, "migrate: down %s\n", r.Source.Path)
	case "status":
		statuses, err := p.Status(ctx)
		if err != nil {
			return fmt.Errorf("migrate status: %w", err)
		}
		for _, s := range statuses {
			_, _ = fmt.Fprintf(out, "%-8s %s\n", s.State, s.Source.Path)
		}
	default:
		return fmt.Errorf("migrate: comando %q desconocido (up, down o status)", command)
	}
	return nil
}

var migrationName = regexp.MustCompile(`^[a-z0-9_]{3,60}$`)

// sqlTemplate is the body of a new migration. Keep the SQL portable (postgres, mysql, sqlite) when you can.
var sqlTemplate = template.Must(template.New("migration").Parse(`-- +goose Up
-- SQL que aplica el cambio. Funciones o triggers (con ; internos): envuélvelos con las
-- anotaciones StatementBegin y StatementEnd de goose (ver la skill gin-patterns).

-- +goose Down
-- SQL que lo revierte.
`))

// CreateMigration writes an empty, timestamped goose SQL migration into dir and returns its path.
func CreateMigration(dir, name string) (string, error) {
	if !migrationName.MatchString(name) {
		return "", fmt.Errorf("migration: nombre %q inválido (snake_case, 3-60)", name)
	}
	goose.SetLogger(goose.NopLogger())
	if err := goose.CreateWithTemplate(nil, dir, sqlTemplate, name, "sql"); err != nil {
		return "", fmt.Errorf("migration: %w", err)
	}
	matches, err := filepath.Glob(filepath.Join(dir, "*_"+name+".sql"))
	if err != nil || len(matches) == 0 {
		return "", fmt.Errorf("migration: no se encontró el archivo creado en %s", dir)
	}
	if _, err := os.Stat(matches[len(matches)-1]); err != nil {
		return "", fmt.Errorf("migration: %w", err)
	}
	return matches[len(matches)-1], nil
}
