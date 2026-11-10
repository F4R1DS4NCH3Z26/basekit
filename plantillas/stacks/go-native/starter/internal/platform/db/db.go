// Package db opens the database/sql pool for the driver the infra-setup overlay chose, rebinds
// placeholders per dialect and applies the versioned migrations (goose). Every driver is pure Go,
// so the binary builds with CGO_ENABLED=0.
package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"

	gomysql "github.com/go-sql-driver/mysql" // registers "mysql"
	_ "github.com/jackc/pgx/v5/stdlib"       // registers "pgx"
	_ "modernc.org/sqlite"                   // registers "sqlite" (no CGO)

	"app/internal/platform/config"
)

// ErrDisabled is returned when no database overlay is active (DB_DRIVER is empty).
var ErrDisabled = errors.New("db: sin base de datos configurada (skill infra-setup)")

// Querier is what repositories receive: *DB implements it, and so does the transaction of InTx.
// Write every query with `?` placeholders; postgres gets them rewritten to $1, $2… (see Rebind).
type Querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// rebinder wraps a *sql.DB or *sql.Tx and rewrites the placeholders before they reach the driver.
type rebinder struct {
	c      Querier
	dollar bool // postgres
}

func (r rebinder) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return r.c.ExecContext(ctx, r.rebind(query), args...)
}

func (r rebinder) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return r.c.QueryContext(ctx, r.rebind(query), args...)
}

func (r rebinder) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return r.c.QueryRowContext(ctx, r.rebind(query), args...)
}

func (r rebinder) rebind(query string) string {
	if !r.dollar {
		return query
	}
	return Rebind(query)
}

// DB is the pool plus its driver. Repositories receive it as a Querier; transactions go through InTx.
type DB struct {
	rebinder
	pool   *sql.DB
	driver string
}

// Open connects and pings the database. It never runs migrations: that is the migrate service's job.
func Open(ctx context.Context, c config.DB) (*DB, error) {
	name, dsn, err := dsnFor(c)
	if err != nil {
		return nil, err
	}
	pool, err := sql.Open(name, dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open %s: %w", c.Driver, err)
	}
	if c.Driver == "sqlite" {
		pool.SetMaxOpenConns(1) // one writer; also keeps an in-memory database alive across queries
	} else {
		pool.SetMaxOpenConns(20)
		pool.SetMaxIdleConns(5)
		pool.SetConnMaxLifetime(30 * time.Minute)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.PingContext(pingCtx); err != nil {
		_ = pool.Close()
		return nil, fmt.Errorf("db: ping %s: %w", c.Driver, err)
	}
	return &DB{rebinder: rebinder{c: pool, dollar: c.Driver == "postgres"}, pool: pool, driver: c.Driver}, nil
}

// Driver returns postgres, mysql or sqlite.
func (d *DB) Driver() string { return d.driver }

// Pool returns the underlying *sql.DB (goose, stats). Queries through it are not rebound.
func (d *DB) Pool() *sql.DB { return d.pool }

// Close releases the pool.
func (d *DB) Close() error { return d.pool.Close() }

// InTx runs fn inside a transaction: commit if fn returns nil, rollback otherwise.
func (d *DB) InTx(ctx context.Context, fn func(q Querier) error) error {
	tx, err := d.pool.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("db: begin: %w", err)
	}
	if err := fn(rebinder{c: tx, dollar: d.dollar}); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("db: commit: %w", err)
	}
	return nil
}

// Rebind turns every `?` placeholder into $1, $2… (postgres). Question marks inside
// 'string literals', "identifiers" and -- comments are left alone.
func Rebind(query string) string {
	out := make([]byte, 0, len(query)+8)
	n := 0
	var quote byte // the open ' or ", 0 outside quotes
	for i := 0; i < len(query); i++ {
		ch := query[i]
		switch {
		case quote != 0:
			if ch == quote {
				quote = 0 // a doubled '' closes and reopens: same result
			}
		case ch == '\'' || ch == '"':
			quote = ch
		case ch == '-' && i+1 < len(query) && query[i+1] == '-':
			end := len(query)
			for j := i; j < len(query); j++ {
				if query[j] == '\n' {
					end = j
					break
				}
			}
			out = append(out, query[i:end]...)
			i = end - 1
			continue
		case ch == '?':
			n++
			out = append(out, '$')
			out = strconv.AppendInt(out, int64(n), 10)
			continue
		}
		out = append(out, ch)
	}
	return string(out)
}

func dsnFor(c config.DB) (driverName, dsn string, err error) {
	switch c.Driver {
	case "":
		return "", "", ErrDisabled
	case "postgres":
		if c.URL == "" {
			return "", "", errors.New("db: falta DATABASE_URL")
		}
		return "pgx", c.URL, nil // pgx accepts postgresql:// URLs as-is
	case "mysql":
		mc := gomysql.NewConfig() // UTC, native passwords
		mc.User, mc.Passwd, mc.DBName = c.User, c.Password, c.Name
		mc.Net, mc.Addr = "tcp", net.JoinHostPort(c.Host, defaultStr(c.Port, "3306"))
		mc.ParseTime = true
		mc.Params = map[string]string{"charset": "utf8mb4"}
		return "mysql", mc.FormatDSN(), nil
	case "sqlite":
		path := defaultStr(c.Name, "/app/data/app.db")
		return "sqlite", "file:" + path + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)", nil
	default:
		return "", "", fmt.Errorf("db: driver %q no soportado", c.Driver)
	}
}

func defaultStr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
