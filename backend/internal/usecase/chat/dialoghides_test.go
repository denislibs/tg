package chat

import (
	"context"
	"slices"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// spyDialogsCache — DialogsCache, запоминающий, кого сбросили.
type spyDialogsCache struct {
	mu          sync.Mutex
	invalidated []int64
}

func (c *spyDialogsCache) Get(context.Context, int64) ([]domain.DialogRecord, bool) {
	return nil, false
}
func (c *spyDialogsCache) Set(context.Context, int64, []domain.DialogRecord) {}
func (c *spyDialogsCache) Invalidate(_ context.Context, userIDs ...int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.invalidated = append(c.invalidated, userIDs...)
}

// Удаление сообщения меняет последнее сообщение диалога (top_message и
// порядок списка), поэтому снимок списка чатов в кэше (TTL 15 с) обязан
// сбрасываться: «у себя» — зрителю, «у всех» — всем участникам. Иначе
// /chats ещё 15 секунд показывает последним удалённое сообщение.
func TestDeleteMessage_InvalidatesDialogsCache(t *testing.T) {
	ctx := context.Background()
	const a, b int64 = 1, 2

	for _, tc := range []struct {
		name   string
		revoke bool
		want   []int64
	}{
		{"у себя", false, []int64{a}},
		{"у всех", true, []int64{a, b}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in, _ := newInteractor()
			in.SetPublisher(&fakePublisher{})
			chatID, _ := in.CreatePrivateChat(ctx, a, b)
			msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "удалить"})
			if err != nil {
				t.Fatalf("Send: %v", err)
			}
			spy := &spyDialogsCache{}
			in.SetDialogsCache(spy)
			if err := in.DeleteMessage(ctx, chatID, msg.ID, a, tc.revoke); err != nil {
				t.Fatalf("DeleteMessage: %v", err)
			}
			for _, uid := range tc.want {
				if !slices.Contains(spy.invalidated, uid) {
					t.Fatalf("кэш списка чатов пользователя %d не сброшен: сброшены %v", uid, spy.invalidated)
				}
			}
		})
	}
}
