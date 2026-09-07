package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// TestMessagesRepo_MediaHistoryCursorSurvivesInsertOnTop — главный пин задачи:
// вторая страница шаред-медиа берётся КУРСОРОМ по seq последнего показанного
// сообщения (tweb src/components/appSearchSuper.ts:2278-2279 — `offsetId =
// lastItem?.mid`), а не числовым смещением.
//
// Между двумя запросами в чат прилетает новое медиа — ровно то, что в оригинале
// делает живой апдейт, дописывающий кэш СВЕРХУ (tweb
// src/components/sidebarRight/tabs/sharedMedia.tsx:239 — `history.unshift`).
// С `OFFSET` окно на эту вставку сдвигается и вторая страница приезжает с
// дублем последнего элемента первой; с курсором содержимое второй страницы от
// вставки не зависит вовсе.
func TestMessagesRepo_MediaHistoryCursorSurvivesInsertOnTop(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+7460")
	b := seedUser(t, pool, "+7461")
	chatID := createPrivate(t, pool, a, b)
	msgs := NewMessagesRepo(pool)

	insert := func(typ, text string) domain.Message {
		t.Helper()
		seq, err := msgs.NextSeq(ctx, chatID)
		if err != nil {
			t.Fatalf("nextSeq: %v", err)
		}
		m, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: typ, Text: text})
		if err != nil {
			t.Fatalf("insert: %v", err)
		}
		return m
	}

	// Шесть фотографий: seq 1..6, отдаются новыми сверху → 6,5,4,3,2,1.
	var photos []domain.Message
	for i := 0; i < 6; i++ {
		photos = append(photos, insert("photo", ""))
	}

	seqs := func(ms []domain.Message) []int64 {
		out := make([]int64, len(ms))
		for i, m := range ms {
			out[i] = m.Seq
		}
		return out
	}
	eq := func(got []int64, want ...int64) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}

	page1, count, err := msgs.MediaHistory(ctx, chatID, "media", usecasechat.MediaPage{Limit: 2})
	if err != nil {
		t.Fatalf("page1: %v", err)
	}
	if count != 6 {
		t.Fatalf("page1 count=%d, want 6", count)
	}
	if got := seqs(page1); !eq(got, photos[5].Seq, photos[4].Seq) {
		t.Fatalf("page1 seqs=%v, want [%d %d]", got, photos[5].Seq, photos[4].Seq)
	}

	// Живой апдейт: новое медиа поверх уже показанного окна.
	fresh := insert("photo", "")

	page2, count, err := msgs.MediaHistory(ctx, chatID, "media",
		usecasechat.MediaPage{OffsetID: page1[len(page1)-1].Seq, Limit: 2})
	if err != nil {
		t.Fatalf("page2: %v", err)
	}
	if count != 7 {
		t.Fatalf("page2 count=%d, want 7", count)
	}
	// Ни дубля (photos[4]), ни дыры (photos[3] на месте), ни новичка сверху.
	if got := seqs(page2); !eq(got, photos[3].Seq, photos[2].Seq) {
		t.Fatalf("page2 seqs=%v, want [%d %d] (дубль/дыра из-за вставки seq=%d)",
			got, photos[3].Seq, photos[2].Seq, fresh.Seq)
	}

	// Досбор до конца: курсор доводит до самого старого и останавливается.
	page3, _, err := msgs.MediaHistory(ctx, chatID, "media",
		usecasechat.MediaPage{OffsetID: page2[len(page2)-1].Seq, Limit: 10})
	if err != nil {
		t.Fatalf("page3: %v", err)
	}
	if got := seqs(page3); !eq(got, photos[1].Seq, photos[0].Seq) {
		t.Fatalf("page3 seqs=%v, want [%d %d]", got, photos[1].Seq, photos[0].Seq)
	}
	tail, _, err := msgs.MediaHistory(ctx, chatID, "media",
		usecasechat.MediaPage{OffsetID: photos[0].Seq, Limit: 10})
	if err != nil {
		t.Fatalf("tail: %v", err)
	}
	if len(tail) != 0 {
		t.Fatalf("tail=%d сообщений, want 0", len(tail))
	}

}

// TestMessagesRepo_SearchCounters — batch-счётчики (аналог MTProto
// messages.getSearchCounters, tweb src/components/appSearchSuper.ts:2375-2377):
// одним ответом число сообщений по КАЖДОМУ запрошенному фильтру. Пин на
// совпадение с фактическим числом сообщений и на то, что неизвестный фильтр —
// ноль, а не ошибка и не потерянный ключ.
func TestMessagesRepo_SearchCounters(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+7462")
	b := seedUser(t, pool, "+7463")
	chatID := createPrivate(t, pool, a, b)
	msgs := NewMessagesRepo(pool)

	insert := func(typ, text string) domain.Message {
		t.Helper()
		seq, err := msgs.NextSeq(ctx, chatID)
		if err != nil {
			t.Fatalf("nextSeq: %v", err)
		}
		m, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: typ, Text: text})
		if err != nil {
			t.Fatalf("insert: %v", err)
		}
		return m
	}

	// media = photo+video, files = document, music = audio,
	// voice = voice+roundVideo, links = text со ссылкой.
	insert("photo", "")
	insert("photo", "")
	insert("video", "")
	insert("document", "")
	insert("audio", "")
	insert("voice", "")
	insert("roundVideo", "")
	insert("roundVideo", "")
	insert("text", "смотри https://example.com")
	insert("text", "без ссылки")
	deleted := insert("photo", "")
	if err := msgs.SoftDelete(ctx, deleted.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	filters := []string{"media", "files", "links", "music", "voice", "gifs"}
	got, err := msgs.SearchCounters(ctx, chatID, filters)
	if err != nil {
		t.Fatalf("counters: %v", err)
	}
	want := map[string]int{"media": 3, "files": 1, "links": 1, "music": 1, "voice": 3, "gifs": 0}
	for _, f := range filters {
		if got[f] != want[f] {
			t.Fatalf("counter[%s]=%d, want %d (все: %v)", f, got[f], want[f], got)
		}
	}

	// Счётчик обязан совпасть с числом, которое отдаёт постраничная выборка
	// того же фильтра: расхождение здесь — это разъехавшиеся вкладка и грид.
	for _, f := range []string{"media", "files", "links", "music", "voice"} {
		ms, count, err := msgs.MediaHistory(ctx, chatID, f, usecasechat.MediaPage{Limit: 60})
		if err != nil {
			t.Fatalf("history %s: %v", f, err)
		}
		if count != want[f] || len(ms) != want[f] {
			t.Fatalf("history %s: count=%d msgs=%d, want %d", f, count, len(ms), want[f])
		}
	}
}
