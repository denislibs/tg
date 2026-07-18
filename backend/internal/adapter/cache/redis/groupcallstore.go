package redis

import (
	"context"
	"fmt"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// GroupCallStore — участники активных групповых звонков: Redis-set
// groupcall:{chatID}. TTL страхует от «зависших» комнат (все вышли аварийно);
// каждый join продлевает жизнь ключа.
type GroupCallStore struct {
	client *goredis.Client
}

func NewGroupCallStore(client *goredis.Client) *GroupCallStore {
	return &GroupCallStore{client: client}
}

const groupCallTTL = 6 * time.Hour

func groupCallKey(chatID int64) string { return fmt.Sprintf("groupcall:%d", chatID) }

func (s *GroupCallStore) Join(ctx context.Context, chatID, userID int64) error {
	key := groupCallKey(chatID)
	if err := s.client.SAdd(ctx, key, userID).Err(); err != nil {
		return err
	}
	return s.client.Expire(ctx, key, groupCallTTL).Err()
}

func (s *GroupCallStore) Leave(ctx context.Context, chatID, userID int64) error {
	return s.client.SRem(ctx, groupCallKey(chatID), userID).Err()
}

func (s *GroupCallStore) Participants(ctx context.Context, chatID int64) ([]int64, error) {
	vals, err := s.client.SMembers(ctx, groupCallKey(chatID)).Result()
	if err != nil {
		return nil, err
	}
	out := make([]int64, 0, len(vals))
	for _, v := range vals {
		if id, e := strconv.ParseInt(v, 10, 64); e == nil {
			out = append(out, id)
		}
	}
	return out, nil
}
