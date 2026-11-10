// Package db opens the GORM connection for the driver the infra-setup overlay chose and applies
// the versioned migrations (goose). Every driver is pure Go, so the binary builds with CGO_ENABLED=0.
package db

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/glebarez/sqlite"
	gomysql "github.com/go-sql-driver/mysql"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"app/internal/platform/config"
)

// ErrDisabled is returned when no database overlay is active (DB_DRIVER is empty).
var ErrDisabled = errors.New("db: sin base de datos configurada (skill infra-setup)")

// Open connects and pings the database. It never runs migrations: that is the migrate service's job.
func Open(ctx context.Context, c config.DB) (*gorm.DB, error) {
	dialector, err := dialectorFor(c)
	if err != nil {
		return nil, err
	}
	gdb, err := gorm.Open(dialector, &gorm.Config{
		Logger:                 logger.Default.LogMode(logger.Warn),
		SkipDefaultTransaction: true,
		TranslateError:         true, // gorm.ErrDuplicatedKey, gorm.ErrForeignKeyViolated
	})
	if err != nil {
		return nil, fmt.Errorf("db: open %s: %w", c.Driver, err)
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, fmt.Errorf("db: pool: %w", err)
	}
	if c.Driver == "sqlite" {
		sqlDB.SetMaxOpenConns(1) // one writer; also keeps an in-memory database alive across queries
	} else {
		sqlDB.SetMaxOpenConns(20)
		sqlDB.SetMaxIdleConns(5)
		sqlDB.SetConnMaxLifetime(30 * time.Minute)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(pingCtx); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("db: ping %s: %w", c.Driver, err)
	}
	return gdb, nil
}

// Close releases the pool.
func Close(gdb *gorm.DB) error {
	sqlDB, err := gdb.DB()
	if err != nil {
		return fmt.Errorf("db: close: %w", err)
	}
	return sqlDB.Close()
}

func dialectorFor(c config.DB) (gorm.Dialector, error) {
	switch c.Driver {
	case "":
		return nil, ErrDisabled
	case "postgres":
		if c.URL == "" {
			return nil, errors.New("db: falta DATABASE_URL")
		}
		return postgres.Open(c.URL), nil // pgx accepts postgresql:// URLs as-is
	case "mysql":
		mc := gomysql.NewConfig() // UTC, native passwords
		mc.User, mc.Passwd, mc.DBName = c.User, c.Password, c.Name
		mc.Net, mc.Addr = "tcp", net.JoinHostPort(c.Host, defaultStr(c.Port, "3306"))
		mc.ParseTime = true
		mc.Params = map[string]string{"charset": "utf8mb4"}
		return mysql.Open(mc.FormatDSN()), nil
	case "sqlite":
		path := defaultStr(c.Name, "/app/data/app.db")
		return sqlite.Open(path + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"), nil
	default:
		return nil, fmt.Errorf("db: driver %q no soportado", c.Driver)
	}
}

func defaultStr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
