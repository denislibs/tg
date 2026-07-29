package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
)

// DialogsCache — bounded-staleness per-user cache of the dialogs snapshot. The
// ListDialogs query is heavy (two LATERAL sub-selects per row, no pagination);
// this absorbs boot/reconnect/multi-tab re-fetch bursts. Short TTL is the safety
// net for mutators we don't explicitly invalidate (pin/mute/theme, peer rename,
// privacy); the hot ones (new message, read) invalidate precisely. Realtime WS
// events reconcile the client's view, so a few seconds of snapshot staleness is
// acceptable.
type DialogsCache struct{ client *goredis.Client }

func NewDialogsCache(client *goredis.Client) *DialogsCache { return &DialogsCache{client: client} }

const dialogsTTL = 15 * time.Second

func dialogsKey(userID int64) string { return fmt.Sprintf("dialogs:%d", userID) }

func (s *DialogsCache) Get(ctx context.Context, userID int64) ([]domain.Dialog, bool) {
	b, err := s.client.Get(ctx, dialogsKey(userID)).Bytes()
	if err != nil {
		return nil, false // miss or redis error — caller falls back to DB
	}
	var d []domain.Dialog
	if json.Unmarshal(b, &d) != nil {
		return nil, false
	}
	return d, true
}

func (s *DialogsCache) Set(ctx context.Context, userID int64, dialogs []domain.Dialog) {
	b, err := json.Marshal(dialogs)
	if err != nil {
		return
	}
	_ = s.client.Set(ctx, dialogsKey(userID), b, dialogsTTL).Err()
}

func (s *DialogsCache) Invalidate(ctx context.Context, userIDs ...int64) {
	if len(userIDs) == 0 {
		return
	}
	pipe := s.client.Pipeline()
	for _, uid := range userIDs {
		pipe.Del(ctx, dialogsKey(uid))
	}
	_, _ = pipe.Exec(ctx)
}
