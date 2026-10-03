package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// «Удалить только у себя» (message_hides) выкидывает сообщение отовсюду, где
// зритель видит сообщения чата, а не только из истории: из вкладок шаред-медиа
// (/chats/{id}/media), их счётчиков (search_counters) и поиска в чате и
// глобального. У собеседника всё остаётся на месте.
func TestMessagesRepo_HiddenForViewerExcludedFromMediaAndSearch(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+7520")
	b := seedUser(t, pool, "+7521")
	chatID := createPrivate(t, pool, a, b)
	msgs := NewMessagesRepo(pool)

	visible := insertMsg(t, msgs, chatID, b, "photo", "кот видимый")
	hidden := insertMsg(t, msgs, chatID, b, "photo", "кот скрытый")
	hiddenLink := insertMsg(t, msgs, chatID, b, "text", "кот https://example.com")
	for _, id := range []int64{hidden.ID, hiddenLink.ID} {
		if err := msgs.HideForUser(ctx, a, id); err != nil {
			t.Fatalf("hide: %v", err)
		}
	}

	// Вкладка медиа.
	got, count, err := msgs.MediaHistory(ctx, chatID, a, "media", usecasechat.MediaPage{Limit: 10})
	if err != nil {
		t.Fatalf("MediaHistory(a): %v", err)
	}
	if count != 1 || !sameIDs(msgSeqs(got), visible.Seq) {
		t.Fatalf("media у a = %v count=%d; ждали только %d", msgSeqs(got), count, visible.Seq)
	}
	got, count, err = msgs.MediaHistory(ctx, chatID, b, "media", usecasechat.MediaPage{Limit: 10})
	if err != nil {
		t.Fatalf("MediaHistory(b): %v", err)
	}
	if count != 2 || len(got) != 2 {
		t.Fatalf("media у b = %v count=%d; скрытие a не должно его трогать", msgSeqs(got), count)
	}

	// Счётчики вкладок.
	counters, err := msgs.SearchCounters(ctx, chatID, a, []string{"media", "links"}, nil)
	if err != nil {
		t.Fatalf("SearchCounters(a): %v", err)
	}
	if counters["media"] != 1 || counters["links"] != 0 {
		t.Fatalf("счётчики у a = %v; ждали media=1 links=0", counters)
	}
	counters, err = msgs.SearchCounters(ctx, chatID, b, []string{"media", "links"}, nil)
	if err != nil {
		t.Fatalf("SearchCounters(b): %v", err)
	}
	if counters["media"] != 2 || counters["links"] != 1 {
		t.Fatalf("счётчики у b = %v; ждали media=2 links=1", counters)
	}

	// Поиск в чате.
	got, count = chatSearch(t, msgs, chatID, a, "кот", usecasechat.SearchFilter{}, usecasechat.MediaPage{Limit: 10})
	if count != 1 || !sameIDs(msgSeqs(got), visible.Seq) {
		t.Fatalf("поиск в чате у a = %v count=%d; ждали только %d", msgSeqs(got), count, visible.Seq)
	}
	got, count = chatSearch(t, msgs, chatID, b, "кот", usecasechat.SearchFilter{}, usecasechat.MediaPage{Limit: 10})
	if count != 3 || len(got) != 3 {
		t.Fatalf("поиск в чате у b = %v count=%d; ждали все три", msgSeqs(got), count)
	}

	// Глобальный поиск (фильтр там уже был — пин, чтобы не потерять).
	res, err := msgs.GlobalSearchMessages(ctx, a, usecasechat.GlobalSearchQuery{Q: "кот", Limit: 10})
	if err != nil {
		t.Fatalf("GlobalSearchMessages(a): %v", err)
	}
	if res.Count != 1 || len(res.Messages) != 1 || res.Messages[0].ID != visible.ID {
		t.Fatalf("глобальный поиск у a = %d сообщений count=%d; ждали только видимое", len(res.Messages), res.Count)
	}
}

// Календарь медиа у пикера даты (messages.getSearchResultsCalendar с
// inputMessagesFilterPhotoVideo) — тот же поиск по виду медиа: фото, удалённое
// зрителем «у себя», не попадает ни в счётчик дня, ни в его превью. У
// собеседника день остаётся полным.
func TestMessagesRepo_CalendarMonthExcludesHiddenForViewer(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+7522")
	b := seedUser(t, pool, "+7523")
	chatID := createPrivate(t, pool, a, b)
	msgs := NewMessagesRepo(pool)

	photo := func(key string) domain.Message {
		t.Helper()
		mediaID := seedMedia(t, pool, b, key)
		seq, err := msgs.NextSeq(ctx, chatID)
		if err != nil {
			t.Fatalf("nextSeq: %v", err)
		}
		m, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: b, Type: "photo", MediaID: &mediaID})
		if err != nil {
			t.Fatalf("insert: %v", err)
		}
		return m
	}
	visible := photo("cal-visible")
	hidden := photo("cal-hidden")
	if err := msgs.HideForUser(ctx, a, hidden.ID); err != nil {
		t.Fatalf("hide: %v", err)
	}

	from := time.Now().Add(-24 * time.Hour)
	to := time.Now().Add(24 * time.Hour)
	days, err := msgs.CalendarMonth(ctx, chatID, a, from, to)
	if err != nil {
		t.Fatalf("CalendarMonth(a): %v", err)
	}
	if len(days) != 1 || days[0].Count != 1 || days[0].TopSeq != visible.Seq || days[0].MaxSeq != visible.Seq {
		t.Fatalf("календарь у a = %+v; ждали один день с count=1 и превью %d", days, visible.Seq)
	}
	days, err = msgs.CalendarMonth(ctx, chatID, b, from, to)
	if err != nil {
		t.Fatalf("CalendarMonth(b): %v", err)
	}
	if len(days) != 1 || days[0].Count != 2 || days[0].TopSeq != hidden.Seq {
		t.Fatalf("календарь у b = %+v; ждали count=2 и превью %d — скрытие a его не трогает", days, hidden.Seq)
	}
}
