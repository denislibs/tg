package chat

import (
	"context"
	"testing"
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
