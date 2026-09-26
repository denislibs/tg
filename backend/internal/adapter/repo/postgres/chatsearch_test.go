package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

func msgSeqs(ms []domain.Message) []int64 {
	out := make([]int64, len(ms))
	for i, m := range ms {
		out[i] = m.Seq
	}
	return out
}

func chatSearch(t *testing.T, msgs *MessagesRepo, chatID int64, q string, f usecasechat.SearchFilter, page usecasechat.MediaPage) ([]domain.Message, int) {
	t.Helper()
	got, count, err := msgs.SearchMessages(context.Background(), chatID, q, f, page)
	if err != nil {
		t.Fatalf("search %q %+v %+v: %v", q, f, page, err)
	}
	return got, count
}

// TestMessagesRepo_ChatSearchOffsetID — задача 3: поиск в одном чате (чип
// пира глобального поиска → messages.search, tweb appMessagesManager.ts:9966-9982)
// листается курсором offset_id = номер последнего отданного сообщения, а не
// OFFSET. Вставка нового попадания между страницами не даёт дубля.
func TestMessagesRepo_ChatSearchOffsetID(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	a := seedUser(t, pool, "+7490")
	b := seedUser(t, pool, "+7491")
	chatID := createPrivate(t, pool, a, b)
	msgs := NewMessagesRepo(pool)

	var hits []domain.Message
	for i := 0; i < 5; i++ {
		hits = append(hits, insertMsg(t, msgs, chatID, a, "text", "рыжий кот"))
		insertMsg(t, msgs, chatID, b, "text", "собака")
	}

	page1, count := chatSearch(t, msgs, chatID, "кот", usecasechat.SearchFilter{}, usecasechat.MediaPage{Limit: 2})
	if count != 5 || !sameIDs(msgSeqs(page1), hits[4].Seq, hits[3].Seq) {
		t.Fatalf("page1 = %v count=%d, want [%d %d] count=5", msgSeqs(page1), count, hits[4].Seq, hits[3].Seq)
	}

	fresh := insertMsg(t, msgs, chatID, b, "text", "ещё кот") // живой апдейт сверху

	page2, count := chatSearch(t, msgs, chatID, "кот", usecasechat.SearchFilter{},
		usecasechat.MediaPage{OffsetID: page1[len(page1)-1].Seq, Limit: 2})
	if count != 6 || !sameIDs(msgSeqs(page2), hits[2].Seq, hits[1].Seq) {
		t.Fatalf("page2 = %v count=%d, want [%d %d] count=6 (дубль/дыра от вставки seq=%d)",
			msgSeqs(page2), count, hits[2].Seq, hits[1].Seq, fresh.Seq)
	}

	tail, _ := chatSearch(t, msgs, chatID, "кот", usecasechat.SearchFilter{},
		usecasechat.MediaPage{OffsetID: hits[0].Seq, Limit: 2})
	if len(tail) != 0 {
		t.Fatalf("ниже самого старого: %v, want пусто", msgSeqs(tail))
	}
}

// TestMessagesRepo_ChatSearchDatesAndFilter — даты и крупный фильтр поиска в
// чате. filter — лексика вкладок класса (mediaFilterCond: media/files/links/
// music/voice), media_type — мелкая лексика топбар-поиска
// (photo/video/…/roundvideo); обе живые и складываются по И. Пустой q без
// фильтров — вся история чата (messages.search с пустым q и
// inputMessagesFilterEmpty: чип пира без текста, tweb appSearchSuper.ts:2233-2236).
func TestMessagesRepo_ChatSearchDatesAndFilter(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+7492")
	b := seedUser(t, pool, "+7493")
	chatID := createPrivate(t, pool, a, b)
	msgs := NewMessagesRepo(pool)

	txt := insertMsg(t, msgs, chatID, a, "text", "кот без ссылки")
	link := insertMsg(t, msgs, chatID, a, "text", "кот https://example.com")
	photo := insertMsg(t, msgs, chatID, a, "photo", "кот на фото")
	video := insertMsg(t, msgs, chatID, a, "video", "кот на видео")
	voice := insertMsg(t, msgs, chatID, a, "roundVideo", "кот в кружке")
	other := insertMsg(t, msgs, chatID, b, "photo", "без подписи")

	all := usecasechat.MediaPage{Limit: 20}
	cases := []struct {
		name string
		q    string
		f    usecasechat.SearchFilter
		want []int64
	}{
		{"filter=media + q", "кот", usecasechat.SearchFilter{Filter: "media"}, []int64{video.Seq, photo.Seq}},
		{"filter=media без q", "", usecasechat.SearchFilter{Filter: "media"}, []int64{other.Seq, video.Seq, photo.Seq}},
		{"filter=links", "кот", usecasechat.SearchFilter{Filter: "links"}, []int64{link.Seq}},
		{"filter=voice", "", usecasechat.SearchFilter{Filter: "voice"}, []int64{voice.Seq}},
		{"filter=media ∧ media_type=photo", "кот", usecasechat.SearchFilter{Filter: "media", MediaType: "photo"}, []int64{photo.Seq}},
		{"filter=files", "кот", usecasechat.SearchFilter{Filter: "files"}, nil},
		{"неизвестный filter — пусто, а не всё", "кот", usecasechat.SearchFilter{Filter: "gifs"}, nil},
		{"пустой q без фильтров — история", "", usecasechat.SearchFilter{}, []int64{other.Seq, voice.Seq, video.Seq, photo.Seq, link.Seq, txt.Seq}},
	}
	for _, c := range cases {
		got, count := chatSearch(t, msgs, chatID, c.q, c.f, all)
		if !sameIDs(msgSeqs(got), c.want...) || count != len(c.want) {
			t.Fatalf("%s: %v count=%d, want %v", c.name, msgSeqs(got), count, c.want)
		}
	}

	day := time.Date(2026, 1, 11, 0, 0, 0, 0, time.UTC)
	for id, at := range map[int64]time.Time{
		txt.ID:   day.Add(-time.Second),
		link.ID:  day,
		photo.ID: day.Add(24*time.Hour - time.Second),
		video.ID: day.Add(24 * time.Hour),
		voice.ID: day.Add(48 * time.Hour),
		other.ID: day.Add(48 * time.Hour),
	} {
		if _, err := pool.Exec(ctx, `UPDATE messages SET created_at=$2 WHERE id=$1`, id, at); err != nil {
			t.Fatalf("created_at: %v", err)
		}
	}
	f := usecasechat.SearchFilter{MinDate: day.Unix(), MaxDate: day.Add(24*time.Hour).Unix() - 1}
	got, count := chatSearch(t, msgs, chatID, "кот", f, all)
	if !sameIDs(msgSeqs(got), photo.Seq, link.Seq) || count != 2 {
		t.Fatalf("сутки: %v count=%d, want [%d %d]", msgSeqs(got), count, photo.Seq, link.Seq)
	}
	// Даты без q и без фильтра — тоже запрос (чип даты без текста).
	got, _ = chatSearch(t, msgs, chatID, "", usecasechat.SearchFilter{MinDate: day.Add(24 * time.Hour).Unix()}, all)
	if !sameIDs(msgSeqs(got), other.Seq, voice.Seq, video.Seq) {
		t.Fatalf("только min_date: %v, want [%d %d %d]", msgSeqs(got), other.Seq, voice.Seq, video.Seq)
	}
}
