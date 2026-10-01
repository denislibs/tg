package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// users.suggestBirthday — служебное сообщение в личной переписке с тем, кому
// дату предложили; дата едет внутри действия (messageActionSuggestBirthday).
func TestSuggestBirthday(t *testing.T) {
	ctx := context.Background()
	in, _ := newInteractor()
	const from, to = int64(1), int64(2)

	b := domain.Birthday{Day: 8, Month: 3, Year: 1990}
	msg, err := in.SuggestBirthday(ctx, from, to, b)
	if err != nil {
		t.Fatalf("SuggestBirthday: %v", err)
	}
	if msg.Type != "service" || msg.SenderID != from {
		t.Fatalf("сообщение: type=%q sender=%d", msg.Type, msg.SenderID)
	}
	act, ok := msg.Action.(domain.MessageActionSuggestBirthday)
	if !ok {
		t.Fatalf("действие %T, want MessageActionSuggestBirthday", msg.Action)
	}
	// Дискриминатор ставит сервер: клиент прислал голые day/month/year.
	if act.Birthday != (domain.Birthday{Underscore: domain.BirthdayTag, Day: 8, Month: 3, Year: 1990}) {
		t.Fatalf("дата в действии = %+v", act.Birthday)
	}
	chatID, err := in.CreatePrivateChat(ctx, from, to)
	if err != nil || msg.ChatID != chatID {
		t.Fatalf("не в личной переписке: chat=%d want %d (%v)", msg.ChatID, chatID, err)
	}

	// Себе — нельзя; кривая дата — нельзя.
	if _, err := in.SuggestBirthday(ctx, from, from, b); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("себе: %v, want ErrInvalid", err)
	}
	if _, err := in.SuggestBirthday(ctx, from, to, domain.Birthday{Day: 31, Month: 2}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("31 февраля: %v, want ErrInvalid", err)
	}
}
