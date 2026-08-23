package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// pinTestSetup собирает интерактор с группой и живым конвейером сообщений —
// SetPin постит сервисное сообщение через тот же Send, что и групповые экшены.
func pinTestSetup(t *testing.T) (*Interactor, *store, int64) {
	t.Helper()
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Дн"}
	chatID, err := in.CreateGroup(context.Background(), 7, "Team", "", "", false, nil)
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	return in, s, chatID
}

// lastServicePill — последнее СЛУЖЕБНОЕ сообщение чата.
func lastServicePill(t *testing.T, s *store, chatID int64) domain.Message {
	t.Helper()
	msgs := s.messages[chatID]
	if len(msgs) == 0 {
		t.Fatal("в чате нет сообщений")
	}
	last := msgs[len(msgs)-1]
	if last.Action == nil {
		t.Fatalf("последнее сообщение не служебное: %+v", last)
	}
	return last
}

// Закрепление постит служебное сообщение, у действия которого НЕТ НИ ОДНОГО
// параметра: цель адресуется reply_to, превью строит клиент. Открепление
// сообщения не постит — парного действия в схеме не существует.
func TestSetPin_PostsPinServiceMessage(t *testing.T) {
	in, s, chatID := pinTestSetup(t)
	ctx := context.Background()
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 7, Text: "закрепи меня"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	if err := in.SetPin(ctx, chatID, msg.ID, 7, true); err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	pill := lastServicePill(t, s, chatID)
	if _, ok := pill.Action.(domain.MessageActionPinMessage); !ok {
		t.Fatalf("действие = %#v, ждали messageActionPinMessage", pill.Action)
	}
	// Ни адреса цели, ни типа, ни имени медиа, ни обрезанного сервером текста:
	// у конструктора параметров нет вовсе.
	raw, err := json.Marshal(pill.Action)
	if err != nil {
		t.Fatalf("сериализация действия: %v", err)
	}
	if string(raw) != `{"_":"messageActionPinMessage"}` {
		t.Fatalf("действие закрепления несёт параметры: %s", raw)
	}
	if pill.Text != "" {
		t.Fatalf("у пилюли остался текст: %q", pill.Text)
	}
	// Цель — reply_to самой пилюли, ОДНИМ числом (номер в чате).
	if pill.ReplyToID == nil || *pill.ReplyToID != msg.Seq {
		t.Fatalf("цель закрепления = %v; want номер %d", pill.ReplyToID, msg.Seq)
	}
	// Автор пилюли — тот, кто закрепил; отдельного actor_id в действии нет.
	if pill.SenderID != 7 {
		t.Fatalf("автор пилюли = %d; want 7", pill.SenderID)
	}

	before := len(s.messages[chatID])
	if err := in.SetPin(ctx, chatID, msg.ID, 7, false); err != nil {
		t.Fatalf("Unpin: %v", err)
	}
	if got := len(s.messages[chatID]); got != before {
		t.Fatalf("открепление добавило %d сообщений; want 0", got-before)
	}
}

// Превью закреплённого сервер больше не собирает ВООБЩЕ: ни тегов трека, ни
// имени файла, ни обрезанного до 100 символов текста. Клиент строит его той же
// wrapMessageForReply, что рисует цитату ответа, — по ссылке reply_to.
func TestSetPin_NoServerBuiltPreview(t *testing.T) {
	in, s, chatID := pinTestSetup(t)
	ctx := context.Background()
	const mediaID int64 = 42
	s.seedMedia(mediaID, 7)
	s.seedMediaDims(mediaID, domain.MediaSource{
		FileName:  "track.mp3",
		Title:     "Батырбек далбоеб",
		Performer: "denis1488",
	})
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 7, Type: "audio", MediaID: ptr(mediaID)})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := in.SetPin(ctx, chatID, msg.ID, 7, true); err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	pill := lastServicePill(t, s, chatID)
	raw, _ := json.Marshal(pill.Action)
	for _, tag := range []string{"denis1488", "track.mp3", "audio"} {
		if strings.Contains(string(raw), tag) {
			t.Fatalf("сервер снова склеил превью закреплённого: %s", raw)
		}
	}
	if pill.ReplyToID == nil || *pill.ReplyToID != msg.Seq {
		t.Fatalf("цель закрепления = %v; want номер %d", pill.ReplyToID, msg.Seq)
	}
}
