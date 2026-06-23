package messaging

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// seedUser inserts a user and returns its id.
func seedUser(t *testing.T, pool *pgxpool.Pool, phone string) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (phone, display_name) VALUES ($1,$1) RETURNING id`, phone).Scan(&id)
	if err != nil {
		t.Fatalf("seedUser(%s): %v", phone, err)
	}
	return id
}
