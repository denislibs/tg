package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestMessagesRepo_SeqAndInsertAndHistory(t *testing.T) {
	pool := postgres.NewTestDB(t)
	chats := NewChatsRepo()
	msgs := NewMessagesRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+720")
	b := seedUser(t, pool, "+721")
	chatID, _ := chats.CreatePrivateChat(ctx, pool, a, b)

	// Insert 3 messages with monotonically increasing seq.
	for i := 1; i <= 3; i++ {
		seq, err := msgs.NextSeq(ctx, pool, chatID)
		if err != nil {
			t.Fatalf("NextSeq: %v", err)
		}
		if int(seq) != i {
			t.Fatalf("seq = %d, want %d", seq, i)
		}
		if _, err := msgs.Insert(ctx, pool, Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "m"}); err != nil {
			t.Fatalf("Insert: %v", err)
		}
	}

	n, _ := msgs.CountMessages(ctx, pool, chatID)
	if n != 3 {
		t.Fatalf("CountMessages = %d, want 3", n)
	}

	// Newest first from the end.
	hist, err := msgs.GetHistory(ctx, pool, chatID, 0, 0, 10)
	if err != nil || len(hist) != 3 || hist[0].Seq != 3 {
		t.Fatalf("history from end: %+v err=%v", hist, err)
	}

	// Older than seq 3 (inclusive): seq 3,2,1.
	older, _ := msgs.GetHistory(ctx, pool, chatID, 3, 1, 2)
	if len(older) != 2 || older[0].Seq != 3 || older[1].Seq != 2 {
		t.Fatalf("older window: %+v", older)
	}

	// Newer than seq 1: seq 2,3.
	newer, _ := msgs.GetHistory(ctx, pool, chatID, 1, -1, 10)
	if len(newer) != 2 || newer[0].Seq != 2 {
		t.Fatalf("newer window: %+v", newer)
	}
}

func TestMessagesRepo_FindByClientMsgID(t *testing.T) {
	pool := postgres.NewTestDB(t)
	chats := NewChatsRepo()
	msgs := NewMessagesRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+730")
	b := seedUser(t, pool, "+731")
	chatID, _ := chats.CreatePrivateChat(ctx, pool, a, b)

	cmid := "client-1"
	seq, _ := msgs.NextSeq(ctx, pool, chatID)
	if _, err := msgs.Insert(ctx, pool, Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "hi", ClientMsgID: &cmid}); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	got, err := msgs.FindByClientMsgID(ctx, pool, chatID, a, cmid)
	if err != nil || got.Text != "hi" {
		t.Fatalf("FindByClientMsgID = %+v, %v", got, err)
	}
	if _, err := msgs.FindByClientMsgID(ctx, pool, chatID, a, "missing"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestMessagesRepo_GetMessageMeta(t *testing.T) {
	pool := postgres.NewTestDB(t)
	chats := NewChatsRepo()
	msgs := NewMessagesRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+740")
	b := seedUser(t, pool, "+741")
	chatID, _ := chats.CreatePrivateChat(ctx, pool, a, b)
	seq, _ := msgs.NextSeq(ctx, pool, chatID)
	m, _ := msgs.Insert(ctx, pool, Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "x"})

	got, err := msgs.GetMessageMeta(ctx, pool, m.ID)
	if err != nil || got != chatID {
		t.Fatalf("GetMessageMeta = %d, %v; want %d", got, err, chatID)
	}
	if _, err := msgs.GetMessageMeta(ctx, pool, 999999); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
