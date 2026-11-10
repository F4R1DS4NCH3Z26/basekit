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

func TestMigrateSQLite(t *testing.T) {
	ctx := context.Background()
	gdb, err := Open(ctx, config.DB{Driver: "sqlite", Name: filepath.Join(t.TempDir(), "app.db")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = Close(gdb) })

	if err := Migrate(ctx, gdb, "sqlite", fstest.MapFS{}, "up", io.Discard); err != nil {
		t.Fatalf("sin migraciones: %v", err)
	}
	fsys := fstest.MapFS{"00001_create_items.sql": {Data: []byte(
		"-- +goose Up\nCREATE TABLE items (id VARCHAR(26) PRIMARY KEY, name VARCHAR(120) NOT NULL);\n" +
			"INSERT INTO items (id, name) VALUES ('i1', 'uno');\n-- +goose Down\nDROP TABLE items;\n")}}
	if err := Migrate(ctx, gdb, "sqlite", fsys, "up", io.Discard); err != nil {
		t.Fatalf("up: %v", err)
	}
	var name string
	if err := gdb.WithContext(ctx).Raw("SELECT name FROM items WHERE id = ?", "i1").Scan(&name).Error; err != nil || name != "uno" {
		t.Fatalf("query = %q, %v", name, err)
	}
	var out strings.Builder
	if err := Migrate(ctx, gdb, "sqlite", fsys, "status", &out); err != nil || !strings.Contains(out.String(), "applied") {
		t.Fatalf("status = %q, %v", out.String(), err)
	}
	if err := Migrate(ctx, gdb, "sqlite", fsys, "down", io.Discard); err != nil {
		t.Fatalf("down: %v", err)
	}
	if err := Migrate(ctx, gdb, "sqlite", fsys, "sideways", io.Discard); err == nil {
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
