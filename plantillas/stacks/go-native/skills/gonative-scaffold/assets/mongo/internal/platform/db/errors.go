package db

import "go.mongodb.org/mongo-driver/v2/mongo"

// IsUniqueViolation reports whether err is a unique index violation (E11000, also on _id).
// Repositories translate it into their own error (for example ErrEmailTaken).
func IsUniqueViolation(err error) bool { return mongo.IsDuplicateKeyError(err) }
