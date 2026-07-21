package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// text_mention с user_id получателя бампит его счётчик упоминаний; автор
// упоминания у себя счётчик не получает.
func TestSend_TextMentionBumpsUnreadMentions(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	_, err := in.Send(ctx, SendInput{
		ChatID: chatID, SenderID: a, Text: "hi @b",
		Entities: []domain.MessageEntity{{Type: "text_mention", Offset: 3, Length: 2, UserID: b}},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	db, _ := in.ListDialogs(ctx, b)
	if db[0].UnreadMentionsCount != 1 {
		t.Fatalf("b unread mentions = %d, want 1", db[0].UnreadMentionsCount)
	}
	// автор не упоминается сам себя
	da, _ := in.ListDialogs(ctx, a)
	if da[0].UnreadMentionsCount != 0 {
		t.Fatalf("a unread mentions = %d, want 0", da[0].UnreadMentionsCount)
	}
}

// Чтение до seq упоминания снимает бейдж «@»; NextMention находит следующее.
func TestMarkRead_ClearsMentions(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	ent := []domain.MessageEntity{{Type: "text_mention", Offset: 0, Length: 1, UserID: b}}
	m1, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "@", Entities: ent})
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "@", Entities: ent})

	if d, _ := in.ListDialogs(ctx, b); d[0].UnreadMentionsCount != 2 {
		t.Fatalf("before read = %d, want 2", d[0].UnreadMentionsCount)
	}

	// next unread mention past seq 0 is the first message
	seq, msgID, err := in.NextMention(ctx, chatID, b, 0)
	if err != nil {
		t.Fatalf("NextMention: %v", err)
	}
	if seq != m1.Seq || msgID != m1.ID {
		t.Fatalf("NextMention = seq %d msg %d, want seq %d msg %d", seq, msgID, m1.Seq, m1.ID)
	}

	// read up to the first mention only → one left
	if err := in.MarkRead(ctx, chatID, b, m1.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if d, _ := in.ListDialogs(ctx, b); d[0].UnreadMentionsCount != 1 {
		t.Fatalf("after partial read = %d, want 1", d[0].UnreadMentionsCount)
	}
	// the remaining one is m2
	seq, _, err = in.NextMention(ctx, chatID, b, m1.Seq)
	if err != nil || seq != m2.Seq {
		t.Fatalf("NextMention after read = seq %d err %v, want seq %d", seq, err, m2.Seq)
	}

	// read the rest → cleared, and no next mention
	if err := in.MarkRead(ctx, chatID, b, m2.Seq); err != nil {
		t.Fatalf("MarkRead 2: %v", err)
	}
	if d, _ := in.ListDialogs(ctx, b); d[0].UnreadMentionsCount != 0 {
		t.Fatalf("after full read = %d, want 0", d[0].UnreadMentionsCount)
	}
	if _, _, err := in.NextMention(ctx, chatID, b, 0); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("NextMention when none: want ErrNotFound, got %v", err)
	}
}
