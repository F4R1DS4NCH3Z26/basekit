// Package cache opens the optional Redis client (compose.redis.yaml injects REDIS_URL).
// Redis is a cache, rate-limit or queue store, never the primary database.
package cache

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrDisabled is returned when REDIS_URL is empty (no Redis overlay).
var ErrDisabled = errors.New("cache: sin Redis configurado (skill infra-setup --redis)")

// Open parses REDIS_URL (redis://:password@redis:6379/0) and pings the server.
func Open(ctx context.Context, url string) (*redis.Client, error) {
	if url == "" {
		return nil, ErrDisabled
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("cache: REDIS_URL inválida: %w", err)
	}
	client := redis.NewClient(opts)
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("cache: ping: %w", err)
	}
	return client, nil
}
