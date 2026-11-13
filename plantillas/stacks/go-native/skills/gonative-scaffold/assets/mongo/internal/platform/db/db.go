// Package db connects to MongoDB with the official driver (go.mongodb.org/mongo-driver/v2) and creates
// the indexes the modules declare. MongoDB has no migrations: see indexes.go.
package db

import (
	"context"
	"errors"
	"fmt"
	"time"
	"uuid"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/x/mongo/driver/connstring"

	"app/internal/platform/config"
)

// ErrDisabled is returned when no database overlay is active (DB_DRIVER is empty).
var ErrDisabled = errors.New("db: sin base de datos configurada (skill infra-setup)")

// Open connects to MONGO_URL, pings the server and returns the database named in the URL path. It never
// creates indexes: serve does it in dev, and the migrate service (make migrate) in every environment.
func Open(ctx context.Context, c config.DB) (*mongo.Database, error) {
	if c.Driver == "" {
		return nil, ErrDisabled
	}
	cs, err := connstring.ParseAndValidate(c.URL)
	if err != nil {
		return nil, fmt.Errorf("db: MONGO_URL inválida: %w", err)
	}
	if cs.Database == "" {
		return nil, errors.New("db: MONGO_URL no nombra la base de datos (mongodb://…/<bd>)")
	}
	client, err := mongo.Connect(options.Client().ApplyURI(c.URL).SetMaxPoolSize(20))
	if err != nil {
		return nil, fmt.Errorf("db: connect: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("db: ping mongodb: %w", err)
	}
	return client.Database(cs.Database), nil
}

// Close disconnects the client of database, waiting up to 10 s for operations in progress.
func Close(database *mongo.Database) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := database.Client().Disconnect(ctx); err != nil {
		return fmt.Errorf("db: close: %w", err)
	}
	return nil
}

// NewID returns a new document id: a UUID string, stored as _id.
func NewID() string { return uuid.New().String() }
