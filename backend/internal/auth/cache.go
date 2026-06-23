package auth

import (
	"context"
	"time"
)

// SessionCacheTTL is how long a resolved session stays cached.
const SessionCacheTTL = 30 * time.Minute

// CachedSession is what we store under a token hash: enough to authorize a
// request without touching Postgres.
type CachedSession struct {
	User     User  `json:"user"`
	DeviceID int64 `json:"device_id"`
}

// SessionCache is a fast lookup from a token hash to its session. Implementations
// must treat a cache miss as (nil, nil), never an error.
type SessionCache interface {
	GetSession(ctx context.Context, tokenHash string) (*CachedSession, error)
	SetSession(ctx context.Context, tokenHash string, s CachedSession, ttl time.Duration) error
	DelSession(ctx context.Context, tokenHash string) error
}
