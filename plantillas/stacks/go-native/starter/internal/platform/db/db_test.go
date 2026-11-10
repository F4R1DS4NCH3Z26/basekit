package db

import (
	"context"
	"errors"
	"io"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"app/internal/platform/config"
)

func TestOpenWithoutDriverIsDisabled(t *testing.T) {
	if _, err := Open(context.Background(), config.DB{}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
}

func TestRebind(t *testing.T) {
	tests := []struct{ in, want string }{
		{"SELECT 1", "SELECT 1"},
		{"SELECT * FROM t WHERE a = ? AND b = ?", "SELECT * FROM t WHERE a = $1 AND b = $2"},
		{"SELECT '?' , \"x?\" FROM t WHERE a = ?", "SELECT '?' , \"x?\" FROM t WHERE a = $1"},
		{"SELECT 'it''s ?' WHERE a = ?", "SELECT 'it''s ?' WHERE a = $1"},
		{"-- why?\nSELECT ? -- and?\n, ?", "-- why?\nSELECT $1 -- and?\n, $2"},
	}
	for _, tt := range tests {
		if got := Rebind(tt.in); got != tt.want {
			t.Errorf("Rebind(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestMigrateAndQuerySQLite(t *testing.T) {
	ctx := context.Background()
	d, err := Open(ctx, config.DB{Driver: "sqlite", Name: filepath.Join(t.TempDir(), "app.db")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })

	if err := Migrate(ctx, d.Pool(), "sqlite", fstest.MapFS{}, "up", io.Discard); err != nil {
		t.Fatalf("sin migraciones: %v", err)
	}
	fsys := fstest.MapFS{"00001_create_items.sql": {Data: []byte(
		"-- +goose Up\nCREATE TABLE items (id VARCHAR(26) PRIMARY KEY, name VARCHAR(120) NOT NULL);\n" +
			"INSERT INTO items (id, name) VALUES ('i1', 'uno');\n-- +goose Down\nDROP TABLE items;\n")}}
	if err := Migrate(ctx, d.Pool(), "sqlite", fsys, "up", io.Discard); err != nil {
		t.Fatalf("up: %v", err)
	}
	var name string
	if err := d.QueryRowContext(ctx, "SELECT name FROM items WHERE id = ?", "i1").Scan(&name); err != nil || name != "uno" {
		t.Fatalf("query = %q, %v", name, err)
	}
	_, err = d.ExecContext(ctx, "INSERT INTO items (id, name) VALUES (?, ?)", "i1", "otro")
	if !IsUniqueViolation(err) {
		t.Fatalf("id duplicado: err = %v, want unique violation", err)
	}
	rollback := errors.New("rollback")
	err = d.InTx(ctx, func(q Querier) error {
		if _, err := q.ExecContext(ctx, "INSERT INTO items (id, name) VALUES (?, ?)", "i2", "dos"); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("InTx = %v, want rollback", err)
	}
	var n int
	if err := d.QueryRowContext(ctx, "SELECT COUNT(*) FROM items").Scan(&n); err != nil || n != 1 {
		t.Fatalf("tras el rollback hay %d filas (%v), want 1", n, err)
	}
	var out strings.Builder
	if err := Migrate(ctx, d.Pool(), "sqlite", fsys, "status", &out); err != nil || !strings.Contains(out.String(), "applied") {
		t.Fatalf("status = %q, %v", out.String(), err)
	}
	if err := Migrate(ctx, d.Pool(), "sqlite", fsys, "down", io.Discard); err != nil {
		t.Fatalf("down: %v", err)
	}
	if err := Migrate(ctx, d.Pool(), "sqlite", fsys, "sideways", io.Discard); err == nil {
		t.Fatal("un comando desconocido debe fallar")
	}
}

func TestCreateMigrationRejectsBadNames(t *testing.T) {
	for _, name := range []string{"", "ab", "Create-X", "../x"} {
		if _, err := CreateMigration(t.TempDir(), name); err == nil {
			t.Errorf("CreateMigration(%q) debe fallar", name)
		}
	}
	path, err := CreateMigration(t.TempDir(), "create_orders")
	if err != nil || !strings.HasSuffix(path, "_create_orders.sql") {
		t.Fatalf("CreateMigration = %q, %v", path, err)
	}
}
