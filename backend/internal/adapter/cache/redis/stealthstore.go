package redis

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
)

// StealthStore keeps a user's stories stealth-mode window in Redis under
// "stories:stealth:{userID}" (JSON), with a TTL until the later of the two
// timestamps so stale records self-expire. It implements the story usecase's
// StealthStore port.
type StealthStore struct{ rdb *goredis.Client }

var _ storyusecase.StealthStore = (*StealthStore)(nil)

func NewStealthStore(rdb *goredis.Client) *StealthStore { return &StealthStore{rdb: rdb} }

func stealthKey(userID int64) string { return "stories:stealth:" + strconv.FormatInt(userID, 10) }

func (s *StealthStore) Get(ctx context.Context, userID int64) (domain.StealthMode, error) {
	b, err := s.rdb.Get(ctx, stealthKey(userID)).Bytes()
	if errors.Is(err, goredis.Nil) {
		return domain.StealthMode{}, nil // never activated
	}
	if err != nil {
		return domain.StealthMode{}, err
	}
	var m domain.StealthMode
	if err := json.Unmarshal(b, &m); err != nil {
		return domain.StealthMode{}, err
	}
	return m, nil
}

func (s *StealthStore) Set(ctx context.Context, userID int64, mode domain.StealthMode) error {
	b, err := json.Marshal(mode)
	if err != nil {
		return err
	}
	until := mode.CooldownUntil
	if mode.ActiveUntil.After(until) {
		until = mode.ActiveUntil
	}
	ttl := time.Until(until)
	if ttl <= 0 {
		ttl = time.Minute
	}
	return s.rdb.Set(ctx, stealthKey(userID), b, ttl).Err()
}
