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
		Entities: domain.MessageEntities{domain.NewMessageEntityMentionName(3, 2, b)},
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

	ent := domain.MessageEntities{domain.NewMessageEntityMentionName(0, 1, b)}
	m1, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "@", Entities: ent})
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "@", Entities: ent})

	if d, _ := in.ListDialogs(ctx, b); d[0].UnreadMentionsCount != 2 {
		t.Fatalf("before read = %d, want 2", d[0].UnreadMentionsCount)
	}

	// next unread mention past seq 0 is the first message
	seq, err := in.NextMention(ctx, chatID, b, 0)
	if err != nil {
		t.Fatalf("NextMention: %v", err)
	}
	if seq != m1.Seq {
		t.Fatalf("NextMention = %d, want %d", seq, m1.Seq)
	}

	// read up to the first mention only → one left
	if err := in.MarkRead(ctx, chatID, b, m1.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if d, _ := in.ListDialogs(ctx, b); d[0].UnreadMentionsCount != 1 {
		t.Fatalf("after partial read = %d, want 1", d[0].UnreadMentionsCount)
	}
	// the remaining one is m2
	seq, err = in.NextMention(ctx, chatID, b, m1.Seq)
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
	if _, err := in.NextMention(ctx, chatID, b, 0); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("NextMention when none: want ErrNotFound, got %v", err)
	}
}

// «@username» в тексте (без сущности — клиент шлёт его голым текстом) сервер
// резолвит сам: упомянутый участник получает упоминание; отправитель, не
// упомянутый участник и не-участник — нет. Прочтение снимает бейдж.
func TestSend_UsernameMentionBumpsUnreadMentions(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const alice, bob, carol, dave int64 = 1, 2, 3, 4
	chatID, _ := in.CreatePrivateChat(ctx, alice, bob)
	s.chatType[chatID] = "group"
	s.members[chatID][carol] = &member{}
	s.seedUsername(alice, "alice_ivanova")
	s.seedUsername(bob, "bob_petrov")
	s.seedUsername(carol, "carol_x")
	s.seedUsername(dave, "dave_out") // не участник

	m, err := in.Send(ctx, SendInput{
		ChatID: chatID, SenderID: alice,
		Text: "@Bob_Petrov тест, @bob_petrov ещё раз, @alice_ivanova и @dave_out; carol@carol_x.com",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	want := map[int64]int{alice: 0, bob: 1, carol: 0}
	for uid, n := range want {
		d, _ := in.ListDialogs(ctx, uid)
		if d[0].UnreadMentionsCount != n {
			t.Fatalf("user %d unread mentions = %d, want %d", uid, d[0].UnreadMentionsCount, n)
		}
	}
	for _, r := range s.mentions {
		if r.userID == dave {
			t.Fatalf("не-участник получил упоминание: %+v", r)
		}
	}
	if len(m.Entities) != 0 {
		t.Fatalf("entities сообщения изменены: %v", m.Entities)
	}

	if err := in.MarkRead(ctx, chatID, bob, m.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if d, _ := in.ListDialogs(ctx, bob); d[0].UnreadMentionsCount != 0 {
		t.Fatalf("after read = %d, want 0", d[0].UnreadMentionsCount)
	}
}

// A3-21: пуш знает упоминание и ответ — флаг уходит нотификатору (гейт мьюта
// пробивается им в ShouldNotify).
func TestSend_NotifierKnowsMentionAndReply(t *testing.T) {
	in, s := newInteractor()
	n := &fakeNotifier{}
	in.SetNotifier(n)
	ctx := context.Background()
	const chatID, a, b, c int64 = 77, 1, 2, 3
	s.seedChat(chatID, domain.ChatTypeGroup, a, b, c)
	orig, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "вопрос"})
	n.recipients, n.mentioned = nil, nil
	seq := orig.Seq
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "ответ", ReplyToID: &seq}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !n.mentioned[b] || n.mentioned[c] {
		t.Fatalf("mentioned = %v, want только автору оригинала (%d)", n.mentioned, b)
	}
}
