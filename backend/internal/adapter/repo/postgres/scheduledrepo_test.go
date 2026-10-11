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
	// До конца: репозиторий читает колонки текущей схемы (0169 и далее).
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("0168+: %v", err)
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

	oldAt := online.SendAt
	online.WhenOnline, online.SendAt, online.Text = false, time.Now().Add(-time.Minute), "по времени"
	if err := r.Update(ctx, online, oldAt, true); err != nil {
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

// Аренда публикации (0169): правка и снятие автором не трогают строку в
// аренде, второй публикатор её не берёт, перепостановка условна по сроку,
// Due её не отдаёт; битый снимок помечается, а не глушится.
func TestScheduledRepo_ClaimRescheduleUnclaimed(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+79990001690")
	b := seedUser(t, pool, "+79990001691")
	chatID := seedPrivateChat(t, pool, a, b)
	r := NewScheduledRepo(pool)
	at := time.Now().Add(-time.Minute).Truncate(time.Microsecond)
	m, _, err := r.Create(ctx, domain.ScheduledMessage{ChatID: chatID, SenderID: a, Type: "text", Text: "x", SendAt: at, RepeatPeriod: 86400,
		PaidStars: 5, PaidTo: b})
	if err != nil {
		t.Fatal(err)
	}
	if m.PaidStars != 5 || m.PaidTo != b {
		t.Fatalf("оплата постановки (0170): %d → %d", m.PaidStars, m.PaidTo)
	}
	if _, ok, err := r.Claim(ctx, m.ID, at.Add(time.Second), false, time.Minute, true); err != nil || ok {
		t.Fatalf("claim по чужому сроку: ok=%v err=%v", ok, err)
	}
	got, ok, err := r.Claim(ctx, m.ID, at, false, time.Minute, true)
	if err != nil || !ok || got.Attempts != 1 {
		t.Fatalf("claim: ok=%v err=%v attempts=%d", ok, err, got.Attempts)
	}
	if _, ok, _ := r.Claim(ctx, m.ID, at, false, time.Minute, true); ok {
		t.Fatal("вторая аренда той же строки")
	}
	if due, _ := r.Due(ctx, time.Now(), 10); len(due) != 0 {
		t.Fatalf("Due отдал строку в аренде: %d", len(due))
	}
	m.Text = "правка"
	if err := r.Update(ctx, m, at, false); err != domain.ErrNotFound {
		t.Fatalf("правка строки в аренде: %v, want ErrNotFound", err)
	}
	if del, _ := r.DeleteUnclaimed(ctx, []int64{m.ID}); len(del) != 0 {
		t.Fatal("снятие автором строки в аренде")
	}
	if _, ok, _ := r.Reschedule(ctx, m.ID, at.Add(time.Second), at.Add(24*time.Hour)); ok {
		t.Fatal("перепостановка по чужому сроку")
	}
	next, ok, err := r.Reschedule(ctx, m.ID, at, at.Add(24*time.Hour))
	if err != nil || !ok || next.Occurrence != 1 || next.Attempts != 0 || next.Text != "x" || next.PaidStars != 0 || next.PaidTo != 0 {
		t.Fatalf("перепостановка: %+v ok=%v err=%v", next, ok, err)
	}
	if err := r.Update(ctx, next, at, false); err != domain.ErrNotFound {
		t.Fatalf("правка по прочитанному до перепостановки сроку: %v, want ErrNotFound", err)
	}
	if err := r.Update(ctx, next, next.SendAt, false); err != nil {
		t.Fatalf("правка после снятия аренды: %v", err)
	}
	if _, ok, _ := r.Claim(ctx, m.ID, next.SendAt, false, time.Minute, true); !ok {
		t.Fatal("claim после перепостановки")
	}
	if err := r.Release(ctx, m.ID, time.Hour); err != nil {
		t.Fatal(err)
	}
	if due, _ := r.Due(ctx, next.SendAt.Add(time.Second), 10); len(due) != 0 {
		t.Fatal("Due отдал строку в отступе после сбоя")
	}
	if del, _ := r.DeleteUnclaimed(ctx, []int64{m.ID}); len(del) != 1 {
		t.Fatal("снятие после Release")
	}
	if err := r.Update(ctx, next, next.SendAt, false); err != domain.ErrNotFound {
		t.Fatalf("правка снятой строки: %v, want ErrNotFound", err)
	}
	if err := NewTxManager(pool).WithinTx(ctx, func(ctx context.Context) error {
		return r.LockQueue(ctx, chatID, a)
	}); err != nil {
		t.Fatalf("LockQueue: %v", err)
	}
	var broken int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO scheduled_messages (chat_id, sender_id, type, text, send_at, params)
		 VALUES ($1,$2,'text','b',now(), '{"grouped_id":"не число"}') RETURNING id`, chatID, a).Scan(&broken); err != nil {
		t.Fatal(err)
	}
	if bm, err := r.ByID(ctx, broken); err != nil || !bm.ParamsBroken {
		t.Fatalf("битый снимок: %+v err=%v", bm, err)
	}
}

// 0170: оплаченные строки чата снимаются для возврата; TakeUpTo не уводит в минус.
func TestScheduledRepo_TakePaidAndStarsTakeUpTo(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+79990001700")
	b := seedUser(t, pool, "+79990001701")
	chatID := seedPrivateChat(t, pool, a, b)
	r := NewScheduledRepo(pool)
	at := time.Now().Add(time.Hour)
	if _, _, err := r.Create(ctx, domain.ScheduledMessage{ChatID: chatID, SenderID: a, Type: "text", Text: "p", SendAt: at, PaidStars: 5, PaidTo: b}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.Create(ctx, domain.ScheduledMessage{ChatID: chatID, SenderID: a, Type: "text", Text: "free", SendAt: at}); err != nil {
		t.Fatal(err)
	}
	taken, err := r.TakePaidByChat(ctx, chatID)
	if err != nil || len(taken) != 1 || taken[0].PaidStars != 5 || taken[0].Text != "p" {
		t.Fatalf("TakePaidByChat: %+v err=%v", taken, err)
	}
	if n, _ := r.CountByChat(ctx, chatID, a); n != 1 {
		t.Fatalf("бесплатная строка снята: осталось %d", n)
	}
	st := NewStarsRepo(pool)
	if _, err := st.AddBalance(ctx, b, 3); err != nil {
		t.Fatal(err)
	}
	if bal, err := st.TakeUpTo(ctx, b, 5); err != nil || bal != 0 {
		t.Fatalf("TakeUpTo: bal=%d err=%v, want 0", bal, err)
	}
	if bal, err := st.TakeUpTo(ctx, a, 5); err != nil || bal != 0 {
		t.Fatalf("TakeUpTo без строки баланса: bal=%d err=%v", bal, err)
	}
}

// P1: догоняющее превью отложенного пишется только в строку с тем же текстом,
// сущностями и решением о превью и вне аренды; решение правится одним ключом
// снимка, остальное в нём не трогается.
func TestScheduledRepo_WebPageIfSameAndChoice(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+79990001720")
	b := seedUser(t, pool, "+79990001721")
	chatID := seedPrivateChat(t, pool, a, b)
	r := NewScheduledRepo(pool)
	choice := &domain.WebPageInput{InvertMedia: true}
	row, _, err := r.Create(ctx, domain.ScheduledMessage{ChatID: chatID, SenderID: a, Type: "text",
		Text: "https://a.example", SendAt: time.Now().Add(time.Hour),
		Params: domain.ScheduledParams{Silent: true, WebPage: choice}})
	if err != nil {
		t.Fatal(err)
	}
	wp := &domain.WebPagePreview{URL: "https://a.example", Title: "A", PhotoID: 0, HasLargeMedia: true}
	if ok, err := r.SetWebPageIfSame(ctx, row.ID, wp, "другой текст", nil, choice); err != nil || ok {
		t.Fatalf("другой текст: ok=%v err=%v", ok, err)
	}
	if ok, err := r.SetWebPageIfSame(ctx, row.ID, wp, row.Text, nil, nil); err != nil || ok {
		t.Fatalf("другое решение о превью: ok=%v err=%v", ok, err)
	}
	if ok, err := r.SetWebPageIfSame(ctx, row.ID, wp, row.Text, nil, choice); err != nil || !ok {
		t.Fatalf("та же строка: ok=%v err=%v", ok, err)
	}
	got, _ := r.ByID(ctx, row.ID)
	if got.WebPage == nil || got.WebPage.Title != "A" || !got.WebPage.HasLargeMedia {
		t.Fatalf("карточка = %+v", got.WebPage)
	}

	if err := r.SetWebPageChoice(ctx, row.ID, &domain.WebPageInput{NoWebpage: true}); err != nil {
		t.Fatal(err)
	}
	got, _ = r.ByID(ctx, row.ID)
	if got.Params.WebPage == nil || !got.Params.WebPage.NoWebpage || got.Params.WebPage.InvertMedia || !got.Params.Silent {
		t.Fatalf("снимок после смены решения = %+v", got.Params)
	}
	if err := r.SetWebPageChoice(ctx, row.ID, nil); err != nil {
		t.Fatal(err)
	}
	if got, _ = r.ByID(ctx, row.ID); got.Params.WebPage != nil || !got.Params.Silent {
		t.Fatalf("снимок после снятия решения = %+v", got.Params)
	}

	// В аренде публикации — не пишется.
	if _, ok, err := r.Claim(ctx, row.ID, got.SendAt, false, time.Minute, false); err != nil || !ok {
		t.Fatalf("claim: ok=%v err=%v", ok, err)
	}
	if ok, err := r.SetWebPageIfSame(ctx, row.ID, nil, row.Text, nil, nil); err != nil || ok {
		t.Fatalf("строка в аренде: ok=%v err=%v", ok, err)
	}
}
