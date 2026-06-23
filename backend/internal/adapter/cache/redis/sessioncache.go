// Package redis holds the redis-backed cache adapters.
package redis

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// SessionCache stores auth sessions in Redis under "session:{tokenHash}". It
// implements the auth usecase's SessionCache port.
type SessionCache struct{ rdb *goredis.Client }

var _ usecaseauth.SessionCache = (*SessionCache)(nil)

func NewSessionCache(rdb *goredis.Client) *SessionCache { return &SessionCache{rdb: rdb} }

func sessionKey(tokenHash string) string { return "session:" + tokenHash }

func (c *SessionCache) GetSession(ctx context.Context, tokenHash string) (*domain.Session, error) {
	b, err := c.rdb.Get(ctx, sessionKey(tokenHash)).Bytes()
	if errors.Is(err, goredis.Nil) {
		return nil, nil // miss
	}
	if err != nil {
		return nil, err
	}
	var s domain.Session
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (c *SessionCache) SetSession(ctx context.Context, tokenHash string, s domain.Session, ttl time.Duration) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return c.rdb.Set(ctx, sessionKey(tokenHash), b, ttl).Err()
}

func (c *SessionCache) DelSession(ctx context.Context, tokenHash string) error {
	return c.rdb.Del(ctx, sessionKey(tokenHash)).Err()
}
