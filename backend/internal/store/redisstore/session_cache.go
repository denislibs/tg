package redisstore

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// SessionCache stores auth sessions in Redis under "session:{tokenHash}".
type SessionCache struct{ rdb *redis.Client }

func NewSessionCache(rdb *redis.Client) *SessionCache { return &SessionCache{rdb: rdb} }

func sessionKey(tokenHash string) string { return "session:" + tokenHash }

func (c *SessionCache) GetSession(ctx context.Context, tokenHash string) (*auth.CachedSession, error) {
	b, err := c.rdb.Get(ctx, sessionKey(tokenHash)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil // miss
	}
	if err != nil {
		return nil, err
	}
	var s auth.CachedSession
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (c *SessionCache) SetSession(ctx context.Context, tokenHash string, s auth.CachedSession, ttl time.Duration) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return c.rdb.Set(ctx, sessionKey(tokenHash), b, ttl).Err()
}

func (c *SessionCache) DelSession(ctx context.Context, tokenHash string) error {
	return c.rdb.Del(ctx, sessionKey(tokenHash)).Err()
}
