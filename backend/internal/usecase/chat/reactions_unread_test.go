package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Реакция на ЧУЖОЕ сообщение бампит счётчик непрочитанных реакций автора;
// у самого реагирующего счётчик не растёт.
func TestReact_BumpsAuthorUnreadReactions(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	// b реагирует на сообщение a
	if err := in.React(ctx, chatID, msg.ID, b, "❤", true); err != nil {
		t.Fatalf("React: %v", err)
	}

	// у автора (a) бейдж реакций = 1
	if d, _ := in.ListDialogs(ctx, a); d[0].UnreadReactionsCount != 1 {
		t.Fatalf("author unread reactions = %d, want 1", d[0].UnreadReactionsCount)
	}
	// у реагирующего (b) — 0
	if d, _ := in.ListDialogs(ctx, b); d[0].UnreadReactionsCount != 0 {
		t.Fatalf("reactor unread reactions = %d, want 0", d[0].UnreadReactionsCount)
	}
}

// Реакция на СВОЁ сообщение счётчик не бампит.
func TestReact_OwnMessageNoBump(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := in.React(ctx, chatID, msg.ID, a, "❤", true); err != nil {
		t.Fatalf("React: %v", err)
	}
	if d, _ := in.ListDialogs(ctx, a); d[0].UnreadReactionsCount != 0 {
		t.Fatalf("self-react unread reactions = %d, want 0", d[0].UnreadReactionsCount)
	}
}

// Прочтение чата автором обнуляет бейдж непрочитанных реакций (MarkRead).
func TestMarkRead_ClearsUnreadReactions(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := in.React(ctx, chatID, msg.ID, b, "❤", true); err != nil {
		t.Fatalf("React: %v", err)
	}
	if d, _ := in.ListDialogs(ctx, a); d[0].UnreadReactionsCount != 1 {
		t.Fatalf("before read = %d, want 1", d[0].UnreadReactionsCount)
	}

	// автор открывает/читает чат → бейдж гаснет
	if err := in.MarkRead(ctx, chatID, a, msg.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if d, _ := in.ListDialogs(ctx, a); d[0].UnreadReactionsCount != 0 {
		t.Fatalf("after read = %d, want 0", d[0].UnreadReactionsCount)
	}

	// явный сброс тоже обнуляет (ReadReactions) — идемпотентно
	if err := in.ReadReactions(ctx, chatID, a); err != nil {
		t.Fatalf("ReadReactions: %v", err)
	}
	if d, _ := in.ListDialogs(ctx, a); d[0].UnreadReactionsCount != 0 {
		t.Fatalf("after explicit read = %d, want 0", d[0].UnreadReactionsCount)
	}
}

// unreadReactionsOf — бейдж ❤ строки диалога пользователя.
func unreadReactionsOf(t *testing.T, in *Interactor, userID int64) int {
	t.Helper()
	d, err := in.ListDialogs(context.Background(), userID)
	if err != nil || len(d) == 0 {
		t.Fatalf("ListDialogs(%d): %v (%d)", userID, err, len(d))
	}
	return d[0].UnreadReactionsCount
}

// A3-09: счётчик — число СООБЩЕНИЙ с непрочитанной реакцией, а не событий.
// Повтор, смена и вторая реакция на то же сообщение его не растят; снятие
// последней непрочитанной — гасит.
func TestReact_UnreadCountsMessagesNotEvents(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const chatID, a, b, c int64 = 70, 1, 2, 3
	s.seedChat(chatID, domain.ChatTypeGroup, a, b, c)
	m1, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "one"})
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "two"})

	steps := []struct {
		who   int64
		msg   int64
		emoji string
		add   bool
		want  int
	}{
		{b, m1.ID, "👍", true, 1},
		{b, m1.ID, "👍", true, 1},  // повтор той же
		{b, m1.ID, "❤", true, 1},  // смена (лимит 1 вытесняет 👍)
		{c, m1.ID, "🔥", true, 1},  // второй реагирующий — то же сообщение
		{b, m2.ID, "👍", true, 2},  // второе сообщение
		{b, m1.ID, "❤", false, 2}, // снята одна из двух на m1
		{c, m1.ID, "🔥", false, 1}, // на m1 непрочитанных не осталось
	}
	for k, st := range steps {
		if err := in.React(ctx, chatID, st.msg, st.who, st.emoji, st.add); err != nil {
			t.Fatalf("шаг %d React: %v", k, err)
		}
		if got := unreadReactionsOf(t, in, a); got != st.want {
			t.Fatalf("шаг %d: unread_reactions = %d, want %d", k, got, st.want)
		}
	}
}

// A3-33: на удалённое у всех сообщение реакция не ставится и бейдж не растёт.
func TestReact_DeletedMessageNotFound(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err := in.DeleteMessage(ctx, chatID, msg.ID, a, true); err != nil {
		t.Fatalf("DeleteMessage: %v", err)
	}
	if err := in.React(ctx, chatID, msg.ID, b, "❤", true); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("React на удалённом = %v, want ErrNotFound", err)
	}
	if got := unreadReactionsOf(t, in, a); got != 0 {
		t.Fatalf("unread_reactions = %d, want 0", got)
	}
}

// A3-27: прочтение гасит реакции только на сообщениях до горизонта.
func TestMarkRead_ClearsReactionsOnlyUpToHorizon(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	m1, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "one"})
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "two"})
	_ = in.React(ctx, chatID, m1.ID, b, "👍", true)
	_ = in.React(ctx, chatID, m2.ID, b, "👍", true)
	if err := in.MarkRead(ctx, chatID, a, m1.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if got := unreadReactionsOf(t, in, a); got != 1 {
		t.Fatalf("после прочтения до m1: unread_reactions = %d, want 1", got)
	}
}

// A2-14 / A3-28: «прочитать реакции» — кадр своим устройствам через журнал,
// агрегатом их глазами без pFlags.unread; A2-13: поставившему агрегат едет его
// глазами (chosen_order, без min), автору — с pFlags.unread, третьему — min.
func TestReactionFrames_PersonalBodiesAndReadReactions(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const chatID, a, b, c int64 = 71, 1, 2, 3
	s.seedChat(chatID, domain.ChatTypeGroup, a, b, c)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})

	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, b, "👍", true); err != nil {
		t.Fatalf("React: %v", err)
	}
	reactionsOf := func(userID int64) map[string]any {
		d := lastFrameOfType(t, pub, userID, "reaction")
		r, _ := d["reactions"].(map[string]any)
		return r
	}
	minOf := func(r map[string]any) bool { pf, _ := r["pFlags"].(map[string]any); return pf["min"] == true }
	unreadOf := func(r map[string]any) bool {
		rr, _ := r["recent_reactions"].([]any)
		for _, e := range rr {
			pf, _ := e.(map[string]any)["pFlags"].(map[string]any)
			if pf["unread"] == true {
				return true
			}
		}
		return false
	}
	chosen := func(r map[string]any) bool {
		res, _ := r["results"].([]any)
		for _, e := range res {
			if _, ok := e.(map[string]any)["chosen_order"]; ok {
				return true
			}
		}
		return false
	}
	if r := reactionsOf(b); minOf(r) || !chosen(r) {
		t.Fatalf("поставившему: min=%v chosen=%v, want полный агрегат с chosen_order: %#v", minOf(r), chosen(r), r)
	}
	if r := reactionsOf(a); minOf(r) || !unreadOf(r) {
		t.Fatalf("автору: min=%v unread=%v, want без min с pFlags.unread: %#v", minOf(r), unreadOf(r), r)
	}
	if r := reactionsOf(c); !minOf(r) || unreadOf(r) {
		t.Fatalf("третьему: min=%v unread=%v, want min без unread", minOf(r), unreadOf(r))
	}

	before := len(s.updates[a])
	pub.reset()
	if err := in.ReadReactions(ctx, chatID, a); err != nil {
		t.Fatalf("ReadReactions: %v", err)
	}
	if got := len(s.updates[a]) - before; got != 1 {
		t.Fatalf("журнал автора: +%d записей, want 1", got)
	}
	if r := reactionsOf(a); unreadOf(r) {
		t.Fatalf("после прочтения реакций кадр всё ещё несёт unread: %#v", r)
	}
	if pub.countFor(b) != 0 || pub.countFor(c) != 0 {
		t.Fatal("прочтение реакций ушло чужим устройствам")
	}
	if got := unreadReactionsOf(t, in, a); got != 0 {
		t.Fatalf("unread_reactions = %d, want 0", got)
	}
}
