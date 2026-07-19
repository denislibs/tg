package chat

import (
	"context"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeBots — in-memory BotRepo: заданные боты + команды.
type fakeBots struct {
	botIDs map[int64]bool
	cmds   map[int64][]domain.BotCommand
}

func (f fakeBots) IsBot(_ context.Context, userID int64) (bool, error) { return f.botIDs[userID], nil }
func (f fakeBots) Commands(_ context.Context, botID int64) ([]domain.BotCommand, error) {
	return f.cmds[botID], nil
}

// botInteractor: приватный чат user(1) ↔ bot(42), publisher для проверки рассылки.
func botInteractor(t *testing.T) (*Interactor, *store, int64) {
	t.Helper()
	in, s := newInteractor()
	in.SetBots(fakeBots{
		botIDs: map[int64]bool{42: true},
		cmds:   map[int64][]domain.BotCommand{42: {{Command: "start", Description: "s"}}},
	})
	in.SetPublisher(&fakePublisher{})
	chatID, err := in.CreatePrivateChat(context.Background(), 1, 42)
	if err != nil {
		t.Fatal(err)
	}
	return in, s, chatID
}

func TestBotAutoReplyEcho(t *testing.T) {
	in, s, chatID := botInteractor(t)
	ctx := context.Background()
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "text", Text: "привет"}); err != nil {
		t.Fatal(err)
	}
	// в чате: моё сообщение + ответ бота
	msgs := s.messages[chatID]
	if len(msgs) < 2 {
		t.Fatalf("expected bot reply, got %d messages", len(msgs))
	}
	last := msgs[len(msgs)-1]
	if last.SenderID != 42 {
		t.Fatalf("last message not from bot: sender=%d", last.SenderID)
	}
	if !strings.Contains(last.Text, "привет") {
		t.Fatalf("bot did not echo: %q", last.Text)
	}
	if last.ReplyMarkup == nil || len(last.ReplyMarkup.Inline) == 0 {
		t.Fatal("echo reply must carry inline keyboard")
	}
}

func TestBotStartCommand(t *testing.T) {
	in, s, chatID := botInteractor(t)
	ctx := context.Background()
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "text", Text: "/start"})
	last := s.messages[chatID]
	reply := last[len(last)-1]
	if reply.SenderID != 42 || reply.ReplyMarkup == nil || len(reply.ReplyMarkup.Inline) < 2 {
		t.Fatalf("/start must reply with inline keyboard, got %+v", reply.ReplyMarkup)
	}
	// первая кнопка — callback alert, есть url-кнопка
	if reply.ReplyMarkup.Inline[0][0].Callback != "alert" {
		t.Fatalf("unexpected first button: %+v", reply.ReplyMarkup.Inline[0][0])
	}
}

func TestBotCallback(t *testing.T) {
	in, _, chatID := botInteractor(t)
	ctx := context.Background()
	// alert
	ans, err := in.BotCallback(ctx, chatID, 1, 42, "alert")
	if err != nil || !ans.Alert || ans.Text == "" {
		t.Fatalf("alert callback = %+v, %v", ans, err)
	}
	// echo → toast без alert
	ans2, _ := in.BotCallback(ctx, chatID, 1, 42, "echo")
	if ans2.Alert || ans2.Text == "" {
		t.Fatalf("echo callback should be toast: %+v", ans2)
	}
	// не член чата
	if _, err := in.BotCallback(ctx, chatID, 999, 42, "alert"); err != domain.ErrForbidden {
		t.Fatalf("non-member callback should be forbidden, got %v", err)
	}
	// не бот
	if _, err := in.BotCallback(ctx, chatID, 1, 1, "alert"); err != domain.ErrNotFound {
		t.Fatalf("callback to non-bot should be not-found, got %v", err)
	}
}

func TestBotKeyboardCommand(t *testing.T) {
	in, s, chatID := botInteractor(t)
	_, _ = in.Send(context.Background(), SendInput{ChatID: chatID, SenderID: 1, Type: "text", Text: "/keyboard"})
	msgs := s.messages[chatID]
	reply := msgs[len(msgs)-1]
	if reply.ReplyMarkup == nil || len(reply.ReplyMarkup.Keyboard) == 0 {
		t.Fatalf("/keyboard must reply with reply-keyboard, got %+v", reply.ReplyMarkup)
	}
}
