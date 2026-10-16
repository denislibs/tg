package chat

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф7-К: лимиты, которые сервер применяет, живут в domain/limits.go и отдаются
// клиенту через help.getAppConfig / help.getConfig. Тест держит границы по ИМЕНИ
// из domain: сдвиг константы сдвигает и правило, и значение в конфиге.

func TestEdit_PrivateTimeLimit_Boundary(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	chat, _ := in.CreatePrivateChat(ctx, 1, 2)
	m, _ := in.Send(ctx, SendInput{ChatID: chat, SenderID: 1, Text: "старое"})

	age := func(d time.Duration) {
		s.mu.Lock()
		for idx := range s.messages[chat] {
			s.messages[chat][idx].CreatedAt = time.Now().Add(-d)
		}
		s.mu.Unlock()
	}

	age(domain.EditTimeLimit - time.Minute)
	if _, err := in.EditMessage(ctx, chat, m.ID, 1, "ещё можно", nil); err != nil {
		t.Fatalf("правка за минуту до срока: %v", err)
	}
	age(domain.EditTimeLimit + time.Second)
	if _, err := in.EditMessage(ctx, chat, m.ID, 1, "уже поздно", nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("правка через EditTimeLimit+1с: %v, want ErrForbidden", err)
	}
}

func TestSend_TextLengthBoundary(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	chat, _ := in.CreatePrivateChat(ctx, 1, 2)

	if _, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: 1, Text: strings.Repeat("я", domain.MaxMessageRunes)}); err != nil {
		t.Fatalf("ровно MaxMessageRunes рун: %v", err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: 1, Text: strings.Repeat("я", domain.MaxMessageRunes+1)}); err == nil {
		t.Fatal("MaxMessageRunes+1 рун принято")
	}
}
