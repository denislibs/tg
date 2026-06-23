package redis

import (
	"context"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// PresenceStore implements the presence usecase's PresenceStore port over Redis.
type PresenceStore struct{ rdb *goredis.Client }

func NewPresenceStore(rdb *goredis.Client) *PresenceStore { return &PresenceStore{rdb: rdb} }

func presKey(userID int64) string     { return "presence:" + strconv.FormatInt(userID, 10) }
func lastSeenKey(userID int64) string { return "lastseen:" + strconv.FormatInt(userID, 10) }

// SetOnlineNX sets the presence key only if absent, returning true on the
// offline→online transition.
func (s *PresenceStore) SetOnlineNX(ctx context.Context, userID int64, ttl time.Duration) (bool, error) {
	return s.rdb.SetNX(ctx, presKey(userID), "1", ttl).Result()
}

// Refresh extends the presence TTL, returning false if the key had expired.
func (s *PresenceStore) Refresh(ctx context.Context, userID int64, ttl time.Duration) (bool, error) {
	return s.rdb.Expire(ctx, presKey(userID), ttl).Result()
}

// SetOffline clears the presence key and records last-seen.
func (s *PresenceStore) SetOffline(ctx context.Context, userID int64, lastSeen int64) error {
	s.rdb.Del(ctx, presKey(userID))
	s.rdb.Set(ctx, lastSeenKey(userID), lastSeen, 0)
	return nil
}

// IsOnline reports whether the presence key exists.
func (s *PresenceStore) IsOnline(ctx context.Context, userID int64) (bool, error) {
	n, err := s.rdb.Exists(ctx, presKey(userID)).Result()
	return n > 0, err
}

// LastSeen returns the recorded last-seen (ms), or 0 if none.
func (s *PresenceStore) LastSeen(ctx context.Context, userID int64) (int64, error) {
	return s.rdb.Get(ctx, lastSeenKey(userID)).Int64()
}
