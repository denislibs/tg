package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// insertMsg кладёт сообщение в чат следующим номером.
func insertMsg(t *testing.T, msgs *MessagesRepo, chatID, sender int64, typ, text string) domain.Message {
	t.Helper()
	ctx := context.Background()
	seq, err := msgs.NextSeq(ctx, chatID)
	if err != nil {
		t.Fatalf("nextSeq: %v", err)
	}
	m, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: sender, Type: typ, Text: text})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	return m
}

func msgIDs(ms []domain.Message) []int64 {
	out := make([]int64, len(ms))
	for i, m := range ms {
		out[i] = m.ID
	}
	return out
}

func sameIDs(got []int64, want ...int64) bool {
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

func globalSearch(t *testing.T, msgs *MessagesRepo, userID int64, q usecasechat.GlobalSearchQuery) usecasechat.GlobalSearchResult {
	t.Helper()
	res, err := msgs.GlobalSearchMessages(context.Background(), userID, q)
	if err != nil {
		t.Fatalf("global search %+v: %v", q, err)
	}
	return res
}

// TestMessagesRepo_GlobalSearchNextRate — главный пин задачи 1: глобальная
// выдача листается курсором сервера `next_rate`, а не числовым смещением
// (tweb appSearchSuper.ts:2288 — `nextRate: this.nextRates[type] ??= 0` в
// запросе, :2321 — `this.nextRates[type] = value.nextRate` из ответа, :2312 —
// «всё загружено», когда `!value.nextRate`).
//
// Между страницами в выдачу попадает новое сообщение — ровно то, что делает
// живой апдейт, дописывающий кэш вкладки сверху. С `OFFSET` окно сдвигается и
// вторая страница приезжает с дублем; с курсором — нет. Последняя страница —
// без `next_rate`, в том числе когда её длина РОВНО равна лимиту (иначе клиент
// сделает лишний пустой запрос и только по нему поймёт, что всё).
func TestMessagesRepo_GlobalSearchNextRate(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	a := seedUser(t, pool, "+7470")
	b := seedUser(t, pool, "+7471")
	c := seedUser(t, pool, "+7472")
	ab := createPrivate(t, pool, a, b)
	ac := createPrivate(t, pool, a, c)
	bc := createPrivate(t, pool, b, c) // чужой для a
	msgs := NewMessagesRepo(pool)

	// Пять попаданий вперемешку по двум чатам a; мимо — чужой чат и промах.
	var hits []domain.Message
	for i := 0; i < 5; i++ {
		chat := ab
		if i%2 == 1 {
			chat = ac
		}
		hits = append(hits, insertMsg(t, msgs, chat, a, "text", "рыжий кот"))
	}
	insertMsg(t, msgs, bc, b, "text", "чужой кот")
	insertMsg(t, msgs, ab, a, "text", "собака")

	q := usecasechat.GlobalSearchQuery{Q: "кот", Limit: 2}
	page1 := globalSearch(t, msgs, a, q)
	if page1.Count != 5 || !sameIDs(msgIDs(page1.Messages), hits[4].ID, hits[3].ID) {
		t.Fatalf("page1 = %v count=%d, want [%d %d] count=5", msgIDs(page1.Messages), page1.Count, hits[4].ID, hits[3].ID)
	}
	if page1.NextRate != hits[3].ID {
		t.Fatalf("page1 next_rate = %d, want %d (id последнего отданного)", page1.NextRate, hits[3].ID)
	}

	// Живой апдейт: новое попадание поверх показанного окна.
	fresh := insertMsg(t, msgs, ab, b, "text", "ещё кот")

	q.OffsetRate = page1.NextRate
	page2 := globalSearch(t, msgs, a, q)
	if !sameIDs(msgIDs(page2.Messages), hits[2].ID, hits[1].ID) {
		t.Fatalf("page2 = %v, want [%d %d] (дубль/дыра от вставки id=%d)",
			msgIDs(page2.Messages), hits[2].ID, hits[1].ID, fresh.ID)
	}
	if page2.Count != 6 || page2.NextRate != hits[1].ID {
		t.Fatalf("page2 count=%d next_rate=%d, want 6/%d", page2.Count, page2.NextRate, hits[1].ID)
	}

	// Хвост короче лимита — без next_rate.
	q.OffsetRate = page2.NextRate
	page3 := globalSearch(t, msgs, a, q)
	if !sameIDs(msgIDs(page3.Messages), hits[0].ID) || page3.NextRate != 0 {
		t.Fatalf("page3 = %v next_rate=%d, want [%d] без next_rate", msgIDs(page3.Messages), page3.NextRate, hits[0].ID)
	}

	// Хвост РОВНО в лимит — тоже без next_rate.
	q.OffsetRate = hits[2].ID
	exact := globalSearch(t, msgs, a, q)
	if !sameIDs(msgIDs(exact.Messages), hits[1].ID, hits[0].ID) || exact.NextRate != 0 {
		t.Fatalf("exact = %v next_rate=%d, want [%d %d] без next_rate",
			msgIDs(exact.Messages), exact.NextRate, hits[1].ID, hits[0].ID)
	}
}
