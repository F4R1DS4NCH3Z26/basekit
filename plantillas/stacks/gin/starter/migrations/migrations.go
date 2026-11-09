// Package migrations embeds the versioned SQL migrations (goose format) into the binary.
// Create one with `make migration NAME=create_orders`; apply them with `make migrate`.
package migrations

import "embed"

// FS holds every *.sql file of this directory. The pattern also matches this file, so the
// package compiles before the first migration exists; goose skips files without a version.
//
//go:embed *
var FS embed.FS
