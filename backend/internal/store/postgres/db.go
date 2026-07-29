package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a pgx connection pool. Pool sizing is taken from the URL
// (pool_max_conns=… etc.) when present; otherwise we apply a production default
// instead of pgx's tiny default of max(4, NumCPU). A too-small pool silently
// serializes concurrent requests on Acquire — under write fan-out load that
// collapses throughput while Postgres sits mostly idle (measured: capped at 5
// backend connections at 64-way concurrency against max_connections=100).
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse pool config: %w", err)
	}
	if !strings.Contains(databaseURL, "pool_max_conns") {
		cfg.MaxConns = 40
	}
	if !strings.Contains(databaseURL, "pool_min_conns") {
		cfg.MinConns = 4
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}
