package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// MessageByClientMsgID — сквозное чтение по паре «чат + автор», и участие в
// чате оно проверяет так же, как соседи по файлу (ListPins, MessageViewers):
// иначе метод отвечал бы про чат, к которому спрашивающий отношения не имеет.
func TestMessageByClientMsgID_MemberOnly(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const chatID, member int64 = 5, 7
	s.seedChat(chatID, domain.ChatTypeGroup, member)

	sent, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: member, Type: "text", Text: "привет", ClientMsgID: "k1"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	got, err := in.MessageByClientMsgID(ctx, chatID, member, "k1")
	if err != nil {
		t.Fatalf("участнику отказано: %v", err)
	}
	if got.ID != sent.ID {
		t.Fatalf("вернулось сообщение %d, отправлено %d", got.ID, sent.ID)
	}

	// Ключа нет — ErrNotFound: участие проверено, сообщения просто нет.
	if _, err := in.MessageByClientMsgID(ctx, chatID, member, "k2"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("по несуществующему ключу вернулось %v, ожидался domain.ErrNotFound", err)
	}

	// Вышедший из чата больше не читает даже СВОИ сообщения: строка в messages
	// на месте, нет только строки членства — ровно то, что проверяет гвард.
	s.mu.Lock()
	delete(s.members[chatID], member)
	s.mu.Unlock()
	if _, err := in.MessageByClientMsgID(ctx, chatID, member, "k1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("вышедшему из чата вернулось %v, ожидался domain.ErrNotFound", err)
	}
}
