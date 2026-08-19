package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// pinTestSetup собирает интерактор с группой и живым конвейером сообщений —
// SetPin постит сервисное сообщение через тот же Send, что и групповые экшены.
func pinTestSetup(t *testing.T) (*Interactor, *store, int64) {
	t.Helper()
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64) {
		s.mu.Lock()
		s.chatType[id] = "group"
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

// lastAction парсит JSON-экшен последнего сервисного сообщения чата.
func lastAction(t *testing.T, s *store, chatID int64) map[string]any {
	t.Helper()
	msgs := s.messages[chatID]
	if len(msgs) == 0 {
		t.Fatal("в чате нет сообщений")
	}
	last := msgs[len(msgs)-1]
	if last.Type != "service" {
		t.Fatalf("последнее сообщение не сервисное: %+v", last)
	}
	var a map[string]any
	if err := json.Unmarshal([]byte(last.Text), &a); err != nil {
		t.Fatalf("экшен %q не JSON: %v", last.Text, err)
	}
	return a
}

// Закрепление постит сервисное сообщение с автором и превью цели; открепление —
// нет (парного экшена в Telegram не существует).
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
	a := lastAction(t, s, chatID)
	// Имени актора в экшене больше нет — только ссылка на него.
	if a["action"] != "pin_message" || int64(a["actor_id"].(float64)) != 7 {
		t.Fatalf("экшен = %v", a)
	}
	if _, ok := a["actor"]; ok {
		t.Fatalf("имя актора уехало на провод: %v", a)
	}
	if int64(a["msg_id"].(float64)) != msg.ID || int64(a["msg_seq"].(float64)) != msg.Seq {
		t.Fatalf("цель экшена = %v; want id=%d seq=%d", a, msg.ID, msg.Seq)
	}
	if a["msg_type"] != "text" || a["msg_text"] != "закрепи меня" {
		t.Fatalf("превью = %v", a)
	}
	if _, ok := a["msg_name"]; ok {
		t.Fatalf("у текста не должно быть msg_name: %v", a)
	}

	before := len(s.messages[chatID])
	if err := in.SetPin(ctx, chatID, msg.ID, 7, false); err != nil {
		t.Fatalf("Unpin: %v", err)
	}
	if got := len(s.messages[chatID]); got != before {
		t.Fatalf("открепление добавило %d сообщений; want 0", got-before)
	}
}

// У аудио превью строится из ID3-тегов (tweb messageForReply: «название - исполнитель»),
// а без тегов — из имени файла; подписи у сообщения нет → msg_text отсутствует.
func TestSetPin_AudioPreviewFromTags(t *testing.T) {
	in, s, chatID := pinTestSetup(t)
	ctx := context.Background()
	const mediaID int64 = 42
	s.seedMedia(mediaID, 7)
	s.seedMediaDims(mediaID, MediaDims{
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
	a := lastAction(t, s, chatID)
	if a["msg_type"] != "audio" || a["msg_name"] != "Батырбек далбоеб - denis1488" {
		t.Fatalf("превью аудио = %v", a)
	}
	if _, ok := a["msg_text"]; ok {
		t.Fatalf("у аудио без подписи не должно быть msg_text: %v", a)
	}

	// Файл без тегов — имя файла.
	const bare int64 = 43
	s.seedMedia(bare, 7)
	s.seedMediaDims(bare, MediaDims{FileName: "noname.mp3"})
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 7, Type: "audio", MediaID: ptr(bare)})
	if err := in.SetPin(ctx, chatID, m2.ID, 7, true); err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	if a := lastAction(t, s, chatID); a["msg_name"] != "noname.mp3" {
		t.Fatalf("превью аудио без тегов = %v", a)
	}
}
