package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0168 дописывает строке очереди полный снимок отправки. Строки,
// поставленные прежним кодом (8 колонок), обязаны читаться с пустым снимком,
// а не ронять ленту отложенных.
func TestMigration0168_OldScheduledRowsRead(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()
	if err := storepostgres.MigrateDownTo(url, 162); err != nil {
		t.Fatalf("откат до 0162: %v", err)
	}
	a := seedUser(t, pool, "+79990001680")
	b := seedUser(t, pool, "+79990001681")
	chatID := seedPrivateChat(t, pool, a, b)
	var oldID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO scheduled_messages (chat_id, sender_id, type, text, send_at, when_online)
		 VALUES ($1,$2,'text','старое',now() + interval '1 hour', false) RETURNING id`, chatID, a).Scan(&oldID); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := storepostgres.MigrateUpTo(url, 168); err != nil {
		t.Fatalf("0168: %v", err)
	}
	r := NewScheduledRepo(pool)
	m, err := r.ByID(ctx, oldID)
	if err != nil || m.Text != "старое" || m.Params.Fwd != nil || m.Params.GroupedID != 0 || m.RepeatPeriod != 0 {
		t.Fatalf("старая строка: %+v err=%v", m, err)
	}
}

func TestScheduledRepo_SnapshotIdempotencyAlbumWaits(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+79990001682")
	b := seedUser(t, pool, "+79990001683")
	chatID := seedPrivateChat(t, pool, a, b)
	r := NewScheduledRepo(pool)

	quote, root := "цитата", int64(5)
	cmid := "c-1"
	row := domain.ScheduledMessage{
		ChatID: chatID, SenderID: a, Type: "text", Text: "снимок", SendAt: time.Now().Add(time.Hour),
		RepeatPeriod: 86400, ClientMsgID: &cmid,
		Params: domain.ScheduledParams{ReplyQuoteText: &quote, ThreadRootID: &root, Silent: true, Effect: "fireworks", GroupedID: 77},
	}
	first, created, err := r.Create(ctx, row)
	if err != nil || !created {
		t.Fatalf("create: %v created=%v", err, created)
	}
	again, created, err := r.Create(ctx, row)
	if err != nil || created || again.ID != first.ID {
		t.Fatalf("повтор client_msg_id: id=%d/%d created=%v err=%v", again.ID, first.ID, created, err)
	}
	if n, _ := r.CountByChat(ctx, chatID, a); n != 1 {
		t.Fatalf("строк %d, want 1", n)
	}
	got, err := r.ByID(ctx, first.ID)
	if err != nil || got.Params.ReplyQuoteText == nil || *got.Params.ReplyQuoteText != quote || !got.Params.Silent ||
		got.Params.Effect != "fireworks" || got.RepeatPeriod != 86400 || got.ClientMsgID == nil || *got.ClientMsgID != cmid {
		t.Fatalf("снимок не пережил базу: %+v err=%v", got, err)
	}

	second, _, _ := r.Create(ctx, domain.ScheduledMessage{ChatID: chatID, SenderID: a, Type: "photo", SendAt: time.Now().Add(time.Hour),
		Params: domain.ScheduledParams{GroupedID: 77}})
	album, err := r.ByGroupedID(ctx, chatID, a, 77)
	if err != nil || len(album) != 2 || album[0].ID != first.ID || album[1].ID != second.ID {
		t.Fatalf("альбом: %+v err=%v", album, err)
	}

	wp := &domain.WebPagePreview{URL: "https://example.com", Title: "пример"}
	if err := r.SetWebPage(ctx, second.ID, wp); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.ByID(ctx, second.ID); got.WebPage == nil || got.WebPage.URL != wp.URL {
		t.Fatalf("превью: %+v", got.WebPage)
	}

	online, _, _ := r.Create(ctx, domain.ScheduledMessage{ChatID: chatID, SenderID: a, Type: "text", Text: "когда в сети", SendAt: time.Now(), WhenOnline: true})
	waits, err := r.WhenOnlineWaits(ctx)
	if err != nil || len(waits) != 1 || waits[0].ChatID != chatID || waits[0].SenderID != a || waits[0].PeerID != b {
		t.Fatalf("ожидания: %+v err=%v", waits, err)
	}
	in, _ := r.WhenOnlineIn(ctx, chatID, a)
	if len(in) != 1 || in[0].ID != online.ID {
		t.Fatalf("WhenOnlineIn: %+v", in)
	}

	online.WhenOnline, online.SendAt, online.Text = false, time.Now().Add(-time.Minute), "по времени"
	if err := r.Update(ctx, online); err != nil {
		t.Fatal(err)
	}
	due, _ := r.Due(ctx, time.Now(), 10)
	if len(due) != 1 || due[0].ID != online.ID || due[0].Text != "по времени" {
		t.Fatalf("Due: %+v", due)
	}

	deleted, err := r.DeleteIDs(ctx, []int64{first.ID, first.ID + 1000})
	if err != nil || len(deleted) != 1 || deleted[0] != first.ID {
		t.Fatalf("DeleteIDs: %v err=%v", deleted, err)
	}
	if again, _ := r.DeleteIDs(ctx, []int64{first.ID}); len(again) != 0 {
		t.Fatalf("повторное снятие вернуло %v", again)
	}
}
