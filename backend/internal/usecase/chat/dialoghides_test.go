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

// «Удалить у себя» выкидывает сообщение из вкладки медиа, её счётчика и поиска
// в чате — у того, кто удалил; у собеседника оно остаётся. Юзкейс обязан
// доносить до хранилища, КТО смотрит: без зрителя фильтру message_hides не
// по чему отсекать.
func TestHiddenForMe_ExcludedFromMediaCountersAndSearch(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	kept, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Type: "photo", Text: "кот"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	gone, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Type: "photo", Text: "кот"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := in.DeleteMessage(ctx, chatID, gone.ID, a, false); err != nil {
		t.Fatalf("DeleteMessage(for me): %v", err)
	}

	for _, tc := range []struct {
		viewer int64
		want   int
	}{{a, 1}, {b, 2}} {
		media, err := in.MediaHistory(ctx, chatID, tc.viewer, "media", MediaPage{Limit: 10})
		if err != nil {
			t.Fatalf("MediaHistory(%d): %v", tc.viewer, err)
		}
		if media.Count != tc.want || len(media.Messages) != tc.want {
			t.Fatalf("медиа у %d: count=%d msgs=%d, want %d", tc.viewer, media.Count, len(media.Messages), tc.want)
		}
		if tc.viewer == a && media.Messages[0].ID != kept.ID {
			t.Fatalf("у a во вкладке медиа %d, ждали уцелевшее %d", media.Messages[0].ID, kept.ID)
		}
		counters, err := in.SearchCounters(ctx, chatID, tc.viewer, []string{"media"}, nil)
		if err != nil {
			t.Fatalf("SearchCounters(%d): %v", tc.viewer, err)
		}
		if counters[0].Count != tc.want {
			t.Fatalf("счётчик медиа у %d = %d, want %d", tc.viewer, counters[0].Count, tc.want)
		}
		found, err := in.SearchMessages(ctx, chatID, tc.viewer, "кот", SearchFilter{}, MediaPage{Limit: 10})
		if err != nil {
			t.Fatalf("SearchMessages(%d): %v", tc.viewer, err)
		}
		if found.Count != tc.want || len(found.Messages) != tc.want {
			t.Fatalf("поиск у %d: count=%d msgs=%d, want %d", tc.viewer, found.Count, len(found.Messages), tc.want)
		}
	}
}

// `count` истории — то, что видит зритель: «удалённое у себя» и очищенное в
// него не входит (шапка «Избранного» показывает его как «N messages», tweb
// topbar.ts `messagesCounter`). Юзкейс обязан донести до хранилища зрителя и
// его горизонт очистки — иначе счётчик считает всю таблицу.
func TestHistoryCount_IsViewerVisible(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	var sent []domain.Message
	for i := 0; i < 3; i++ {
		m, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "м"})
		if err != nil {
			t.Fatalf("Send: %v", err)
		}
		sent = append(sent, m)
	}
	if err := in.DeleteMessage(ctx, chatID, sent[2].ID, a, false); err != nil {
		t.Fatalf("DeleteMessage(for me): %v", err)
	}
	for _, tc := range []struct {
		viewer int64
		want   int
	}{{a, 2}, {b, 3}} {
		h, err := in.GetHistory(ctx, chatID, tc.viewer, 0, 0, 40, nil, "")
		if err != nil {
			t.Fatalf("GetHistory(%d): %v", tc.viewer, err)
		}
		if h.Count != tc.want {
			t.Errorf("count истории у %d = %d; want %d", tc.viewer, h.Count, tc.want)
		}
	}
	if err := in.ClearHistory(ctx, chatID, a); err != nil {
		t.Fatalf("ClearHistory: %v", err)
	}
	if h, _ := in.GetHistory(ctx, chatID, a, 0, 0, 40, nil, ""); h.Count != 0 {
		t.Errorf("count после очистки у a = %d; want 0", h.Count)
	}
}
