package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Bot API sendMessage: entities, reply_parameters и disable_notification доходят
// до Send (Ф-6, f6-bots; core.telegram.org/bots/api#sendmessage).

func botSendEnv(t *testing.T) (*Interactor, *store, *fakeNotifier, domain.BotAccount, int64) {
	t.Helper()
	in, s := newInteractor()
	in.SetBots(fakeBots{botIDs: map[int64]bool{42: true}})
	in.SetPublisher(&fakePublisher{})
	notif := &fakeNotifier{}
	in.SetNotifier(notif)
	chatID, err := in.CreatePrivateChat(context.Background(), 1, 42)
	if err != nil {
		t.Fatal(err)
	}
	return in, s, notif, domain.BotAccount{BotID: 42, Username: "b_bot"}, chatID
}

func TestBotSendMessage_EntitiesReplyAndSilent(t *testing.T) {
	in, s, notif, bot, chatID := botSendEnv(t)
	ctx := context.Background()
	first, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "text", Text: "вопрос"})
	if err != nil {
		t.Fatal(err)
	}

	ents := domain.MessageEntities{domain.NewMessageEntityBold(0, 3)}
	before := len(notif.recipients)
	msg, err := in.BotSendMessage(ctx, bot, chatID, "ответ", nil, BotSendOpts{
		Entities: ents, ReplyToSeq: &first.Seq, Silent: true,
	})
	if err != nil {
		t.Fatalf("BotSendMessage: %v", err)
	}
	in.bg.Wait()

	stored := s.messages[chatID][len(s.messages[chatID])-1]
	if len(stored.Entities) != 1 {
		t.Fatalf("entities не дошли: %+v", stored.Entities)
	}
	if _, ok := stored.Entities[0].(domain.MessageEntityBold); !ok {
		t.Fatalf("entity = %T; want MessageEntityBold", stored.Entities[0])
	}
	if stored.ReplyToID == nil || *stored.ReplyToID != first.Seq || msg.Seq != stored.Seq {
		t.Fatalf("reply_to = %v; want номер %d", stored.ReplyToID, first.Seq)
	}
	if len(notif.recipients) != before {
		t.Fatal("disable_notification не подавил пуш")
	}

	// Без disable_notification пуш получателю уходит.
	if _, err := in.BotSendMessage(ctx, bot, chatID, "громко", nil, BotSendOpts{}); err != nil {
		t.Fatal(err)
	}
	in.bg.Wait()
	if len(notif.recipients) != before+1 {
		t.Fatalf("громкое сообщение бота без пуша: %v", notif.recipients)
	}
}
