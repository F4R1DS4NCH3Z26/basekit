package db

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"uuid"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"app/internal/platform/config"
)

// No test here reaches a MongoDB server: make test and make verify stay deterministic.

func TestOpenWithoutDriverIsDisabled(t *testing.T) {
	if _, err := Open(context.Background(), config.DB{}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
}

func TestOpenRejectsURLWithoutDatabase(t *testing.T) {
	_, err := Open(context.Background(), config.DB{Driver: "mongodb", URL: "mongodb://app:secret@db:27017/?authSource=app"})
	if err == nil || !strings.Contains(err.Error(), "no nombra la base de datos") {
		t.Fatalf("err = %v", err)
	}
}

func TestNewIDIsAUUIDString(t *testing.T) {
	id := NewID()
	if _, err := uuid.Parse(id); err != nil || id == NewID() {
		t.Fatalf("NewID() = %q, %v", id, err)
	}
}

// fakeView records what EnsureIndexes asks for. It only has CreateMany: there is nothing to drop with.
type fakeView struct {
	collection string
	created    *[]string
}

func (f fakeView) CreateMany(_ context.Context, models []mongo.IndexModel, _ ...options.Lister[options.CreateIndexesOptions]) ([]string, error) {
	names := make([]string, len(models))
	for i := range models {
		names[i] = f.collection + "_idx"
		*f.created = append(*f.created, f.collection)
	}
	return names, nil
}

func TestEnsureIndexesCreatesEveryDeclaredIndex(t *testing.T) {
	var created []string
	view := func(name string) indexCreator { return fakeView{collection: name, created: &created} }
	cols := []Collection{
		{Name: "orders", Indexes: []mongo.IndexModel{{Keys: bson.D{{Key: "owner_id", Value: 1}}}}},
		{Name: "tags"},
	}
	var out strings.Builder
	if err := ensureIndexes(context.Background(), view, cols, &out); err != nil {
		t.Fatal(err)
	}
	if strings.Join(created, ",") != "orders" {
		t.Fatalf("created = %v, want [orders] (a collection without indexes asks for nothing)", created)
	}
	if !strings.Contains(out.String(), "indexes OK: 2 colecciones") {
		t.Fatalf("out = %q", out.String())
	}
}

func TestEnsureIndexesWithoutCollections(t *testing.T) {
	view := func(string) indexCreator { t.Fatal("no collection to ask for"); return nil }
	if err := ensureIndexes(context.Background(), view, nil, io.Discard); err != nil {
		t.Fatal(err)
	}
}
