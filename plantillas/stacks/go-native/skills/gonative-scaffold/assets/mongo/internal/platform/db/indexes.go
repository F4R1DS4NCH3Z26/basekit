package db

import (
	"context"
	"fmt"
	"io"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Collection declares a module's collection and its indexes. Each module exports one (Indexes, in
// model.go) and cmd/api/main.go lists them in collections().
type Collection struct {
	Name    string
	Indexes []mongo.IndexModel
}

// indexCreator is the part of mongo.IndexView that EnsureIndexes uses: it can create, never drop.
type indexCreator interface {
	CreateMany(ctx context.Context, models []mongo.IndexModel, opts ...options.Lister[options.CreateIndexesOptions]) ([]string, error)
}

// EnsureIndexes creates the declared indexes that are missing; an index that already exists with the same
// keys and options is left as it is. It never drops one: removing an index from a model does not remove
// it from the database. Drop it by hand: make db-shell, db.<collection>.getIndexes() and
// db.<collection>.dropIndex('<name>').
func EnsureIndexes(ctx context.Context, database *mongo.Database, cols []Collection, out io.Writer) error {
	return ensureIndexes(ctx, func(name string) indexCreator { return database.Collection(name).Indexes() }, cols, out)
}

func ensureIndexes(ctx context.Context, view func(collection string) indexCreator, cols []Collection, out io.Writer) error {
	if len(cols) == 0 {
		_, _ = fmt.Fprintln(out, "indexes: ninguna colección declarada (lista collections de cmd/api/main.go)")
		return nil
	}
	for _, c := range cols {
		if len(c.Indexes) == 0 {
			_, _ = fmt.Fprintf(out, "  %s: sin índices declarados\n", c.Name)
			continue
		}
		names, err := view(c.Name).CreateMany(ctx, c.Indexes)
		if err != nil {
			return fmt.Errorf("indexes: %s: %w", c.Name, err)
		}
		_, _ = fmt.Fprintf(out, "  %s: %d índices declarados creados o ya presentes\n", c.Name, len(names))
	}
	_, _ = fmt.Fprintf(out, "indexes OK: %d colecciones\n", len(cols))
	return nil
}
