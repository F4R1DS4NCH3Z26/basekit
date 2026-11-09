package db

import (
	"errors"

	gomysql "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// IsUniqueViolation reports whether err is a UNIQUE or PRIMARY KEY violation on any of the three
// drivers. Repositories translate it into their own error (for example ErrEmailTaken).
func IsUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return pg.Code == "23505" // unique_violation
	}
	var my *gomysql.MySQLError
	if errors.As(err, &my) {
		return my.Number == 1062 // ER_DUP_ENTRY
	}
	var lite *sqlite.Error
	if errors.As(err, &lite) {
		return lite.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE || lite.Code() == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY
	}
	return false
}
