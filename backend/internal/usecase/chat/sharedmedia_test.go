package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// seedSharedMedia набивает чат по одному сообщению каждого вида вкладок и
// возвращает ожидаемые счётчики.
func seedSharedMedia(t *testing.T, in *Interactor, chatID, sender int64) map[string]int {
	t.Helper()
	ctx := context.Background()
	send := func(typ, text string) domain.Message {
		t.Helper()
		m, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: sender, Type: typ, Text: text})
		if err != nil {
			t.Fatalf("send %s: %v", typ, err)
		}
		return m
	}
	send("photo", "")
	send("photo", "")
	send("video", "")
	send("document", "")
	send("audio", "")
	send("voice", "")
	send("roundVideo", "")
	send("roundVideo", "")
	send("text", "смотри https://example.com")
	send("text", "без ссылки")
	return map[string]int{"media": 3, "files": 1, "links": 1, "music": 1, "voice": 3}
}

// Счётчики всех вкладок приезжают ОДНИМ ответом (аналог messages.getSearchCounters,
// tweb src/components/appSearchSuper.ts:2375-2377), запись есть на каждый
// запрошенный фильтр и в порядке запроса, а неизвестный вид — ноль, а не ошибка.
// Пин на потерю фильтра: без записи клиент не сможет сопоставить ответ с
// запросом позиционно и скроет непустую вкладку.
func TestSearchCounters_AllFiltersInOneAnswer(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	want := seedSharedMedia(t, in, chatID, a)

	filters := []string{"media", "files", "links", "music", "voice", "gifs"}
	got, err := in.SearchCounters(ctx, chatID, a, filters)
	if err != nil {
		t.Fatalf("SearchCounters: %v", err)
	}
	if len(got) != len(filters) {
		t.Fatalf("получено %d счётчиков, want %d: %+v", len(got), len(filters), got)
	}
	for i, c := range got {
		if c.Filter != filters[i] {
			t.Fatalf("счётчик #%d = %q, want %q (порядок ответа = порядок запроса)", i, c.Filter, filters[i])
		}
		if c.Count != want[c.Filter] {
			t.Fatalf("counter[%s]=%d, want %d", c.Filter, c.Count, want[c.Filter])
		}
	}

	// То же число обязано прийти и постранично: разъехавшись, вкладка покажет
	// счётчик, который не сходится с содержимым грида.
	for f, n := range want {
		res, err := in.MediaHistory(ctx, chatID, a, f, MediaPage{Limit: 60})
		if err != nil {
			t.Fatalf("MediaHistory %s: %v", f, err)
		}
		if res.Count != n || len(res.Messages) != n {
			t.Fatalf("MediaHistory %s: count=%d msgs=%d, want %d", f, res.Count, len(res.Messages), n)
		}
	}

	// Чужой чат — 403 (domain.ErrNotFound), а не счётчики.
	if _, err := in.SearchCounters(ctx, chatID, 999, filters); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("посторонний получил счётчики: err=%v", err)
	}
}

// Пагинация шаред-медиа идёт КУРСОРОМ по seq последнего показанного сообщения
// (tweb appSearchSuper.ts:2278-2279), поэтому вставка нового медиа СВЕРХУ между
// запросами (tweb sharedMedia.tsx:239 — history.unshift) не меняет содержимое
// второй страницы: ни дубля, ни дыры.
func TestMediaHistory_CursorSurvivesInsertOnTop(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	var photos []domain.Message
	for i := 0; i < 6; i++ {
		m, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo"})
		if err != nil {
			t.Fatalf("send: %v", err)
		}
		photos = append(photos, m)
	}

	seqs := func(ms []domain.Message) []int64 {
		out := make([]int64, len(ms))
		for i, m := range ms {
			out[i] = m.Seq
		}
		return out
	}

	page1, err := in.MediaHistory(ctx, chatID, a, "media", MediaPage{Limit: 2})
	if err != nil {
		t.Fatalf("page1: %v", err)
	}
	if len(page1.Messages) != 2 || page1.Messages[0].Seq != photos[5].Seq || page1.Messages[1].Seq != photos[4].Seq {
		t.Fatalf("page1 seqs = %v, want [%d %d]", seqs(page1.Messages), photos[5].Seq, photos[4].Seq)
	}

	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo"}); err != nil {
		t.Fatalf("live send: %v", err)
	}

	page2, err := in.MediaHistory(ctx, chatID, a, "media",
		MediaPage{OffsetID: page1.Messages[len(page1.Messages)-1].Seq, Limit: 2})
	if err != nil {
		t.Fatalf("page2: %v", err)
	}
	if len(page2.Messages) != 2 || page2.Messages[0].Seq != photos[3].Seq || page2.Messages[1].Seq != photos[2].Seq {
		t.Fatalf("page2 seqs = %v, want [%d %d] (дубль/дыра от вставки сверху)",
			seqs(page2.Messages), photos[3].Seq, photos[2].Seq)
	}

}

// Вкладки shared media рисуют ВЛОЖЕНИЕ, а не сообщение: без собранного
// `Media` клиенту нечего показать — плитка `.grid-item` остаётся пустым
// узлом (`getMediaId(m)` → undefined). История и поиск собирают вложение через
// hydrateMedia; `MediaHistory` обязан делать то же самое, иначе единственная
// ручка, которая отдаёт ТОЛЬКО медиа, отдаёт их без медиа. Найдено на стенде:
// `/chats/-6/media` отвечал сообщениями без поля `media`.
func TestMediaHistory_HydratesAttachment(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := fakeChats{s}.CreatePrivate(ctx, a, b)

	const mediaID int64 = 91
	s.seedMedia(mediaID, a)
	s.seedMediaDims(mediaID, domain.MediaSource{Mime: "image/jpeg", Width: 1280, Height: 720, Size: 26941})
	id := mediaID
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", MediaID: &id}); err != nil {
		t.Fatalf("send: %v", err)
	}

	res, err := in.MediaHistory(ctx, chatID, a, "media", MediaPage{Limit: 10})
	if err != nil {
		t.Fatalf("MediaHistory: %v", err)
	}
	if len(res.Messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(res.Messages))
	}
	photo, ok := res.Messages[0].Media.(*domain.MessageMediaPhoto)
	if !ok {
		t.Fatalf("вложение не собрано: Media = %#v", res.Messages[0].Media)
	}
	// размеры доехали — иначе клиент не зарезервирует бокс плитки
	if w, h := domain.MediaDimensions(photo); w != 1280 || h != 720 {
		t.Fatalf("dims = %dx%d, want 1280x720", w, h)
	}
}
