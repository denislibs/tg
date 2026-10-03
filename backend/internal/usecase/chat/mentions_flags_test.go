package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

const (
	mAlice, mBob, mCarol int64 = 1, 2, 3
)

// mentionGroup — группа Алиса+Боб+Кэрол с @username у каждого.
func mentionGroup(t *testing.T) (*Interactor, *store, int64) {
	t.Helper()
	in, s := newInteractor()
	chatID, err := in.CreatePrivateChat(context.Background(), mAlice, mBob)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	s.chatType[chatID] = domain.ChatTypeGroup
	s.members[chatID][mCarol] = &member{}
	s.seedUsername(mAlice, "alice_ivanova")
	s.seedUsername(mBob, "bob_petrov")
	s.seedUsername(mCarol, "carol_x")
	return in, s, chatID
}

func unreadMentionsOf(s *store, chatID, uid int64) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.members[chatID][uid].mentions
}

// lastMessageFlags — pFlags сообщения в последней записи журнала uid типа typ.
func lastMessageFlags(t *testing.T, s *store, uid int64, typ string) map[string]bool {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	ups := s.updates[uid]
	for i := len(ups) - 1; i >= 0; i-- {
		if ups[i].Type != typ {
			continue
		}
		var p struct {
			Message struct {
				PFlags map[string]bool `json:"pFlags"`
			} `json:"message"`
		}
		if err := json.Unmarshal(ups[i].Payload, &p); err != nil {
			t.Fatalf("payload: %v", err)
		}
		return p.Message.PFlags
	}
	t.Fatalf("у %d нет записи %s", uid, typ)
	return nil
}

func wireFlags(t *testing.T, in *Interactor, viewer int64, m domain.Message) map[string]bool {
	t.Helper()
	w, err := in.MessagesWire(context.Background(), viewer, []domain.Message{m})
	if err != nil {
		t.Fatalf("MessagesWire: %v", err)
	}
	return w[0].(domain.MessageReal).PFlags
}

// Упомянутому сообщение приезжает с mentioned + media_unread — и живым кадром
// (журнал), и в истории; остальным — без них. Прочтение снимает media_unread,
// mentioned остаётся (Telegram).
func TestMentionFlags_FrameAndHistory(t *testing.T) {
	in, s, chatID := mentionGroup(t)
	ctx := context.Background()
	m, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: mAlice, Text: "@bob_petrov привет"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	if f := lastMessageFlags(t, s, mBob, "new_message"); !f["mentioned"] || !f["media_unread"] {
		t.Fatalf("кадр Бобу: pFlags = %v, want mentioned+media_unread", f)
	}
	if f := lastMessageFlags(t, s, mCarol, "new_message"); f["mentioned"] || f["media_unread"] {
		t.Fatalf("кадр Кэрол: pFlags = %v, want без упоминания", f)
	}
	if f := lastMessageFlags(t, s, mAlice, "new_message"); !f["out"] || f["mentioned"] {
		t.Fatalf("кадр Алисе: pFlags = %v, want только out", f)
	}

	if f := wireFlags(t, in, mBob, m); !f["mentioned"] || !f["media_unread"] {
		t.Fatalf("история Боба: pFlags = %v", f)
	}
	if f := wireFlags(t, in, mCarol, m); f["mentioned"] || f["media_unread"] {
		t.Fatalf("история Кэрол: pFlags = %v", f)
	}

	if err := in.MarkRead(ctx, chatID, mBob, m.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if f := wireFlags(t, in, mBob, m); !f["mentioned"] || f["media_unread"] {
		t.Fatalf("история Боба после прочтения: pFlags = %v, want mentioned без media_unread", f)
	}
	if n := unreadMentionsOf(s, chatID, mBob); n != 0 {
		t.Fatalf("после прочтения unread mentions = %d", n)
	}
}

// Ответ на сообщение — упоминание его автора (в группе); ответ на своё — нет;
// в личке ответ не упоминает.
func TestMention_ReplyMentionsOriginalAuthor(t *testing.T) {
	in, s, chatID := mentionGroup(t)
	ctx := context.Background()
	orig, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: mBob, Text: "вопрос"})
	seq := orig.Seq

	r, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: mAlice, Text: "ответ", ReplyToID: &seq})
	if err != nil {
		t.Fatalf("reply: %v", err)
	}
	if n := unreadMentionsOf(s, chatID, mBob); n != 1 {
		t.Fatalf("автор оригинала unread mentions = %d, want 1", n)
	}
	if n := unreadMentionsOf(s, chatID, mCarol); n != 0 {
		t.Fatalf("Кэрол unread mentions = %d, want 0", n)
	}
	if f := lastMessageFlags(t, s, mBob, "new_message"); !f["mentioned"] || !f["media_unread"] {
		t.Fatalf("кадр ответа Бобу: %v", f)
	}
	// Ответ Боба на своё же сообщение — себя не упоминает.
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: mBob, Text: "сам", ReplyToID: &seq}); err != nil {
		t.Fatalf("self reply: %v", err)
	}
	if n := unreadMentionsOf(s, chatID, mBob); n != 1 {
		t.Fatalf("после ответа себе = %d, want 1", n)
	}
	_ = r

	// Личка: ответ — не упоминание.
	priv, _ := in.CreatePrivateChat(ctx, mAlice, mCarol)
	po, _ := in.Send(ctx, SendInput{ChatID: priv, SenderID: mCarol, Text: "привет"})
	pseq := po.Seq
	if _, err := in.Send(ctx, SendInput{ChatID: priv, SenderID: mAlice, Text: "ответ", ReplyToID: &pseq}); err != nil {
		t.Fatalf("private reply: %v", err)
	}
	if n := unreadMentionsOf(s, priv, mCarol); n != 0 {
		t.Fatalf("личка: unread mentions = %d, want 0", n)
	}
}

// Правка: новое упоминание — +1 и mentioned в кадре правки; снятое —
// из счётчика убирается; прежнее остаётся.
func TestMention_EditAddsAndRemoves(t *testing.T) {
	in, s, chatID := mentionGroup(t)
	ctx := context.Background()
	m, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: mAlice, Text: "@bob_petrov привет"})
	if n := unreadMentionsOf(s, chatID, mBob); n != 1 {
		t.Fatalf("до правки Боб = %d", n)
	}

	if _, err := in.EditMessage(ctx, chatID, m.ID, mAlice, "@bob_petrov и @carol_x", nil); err != nil {
		t.Fatalf("edit 1: %v", err)
	}
	if n := unreadMentionsOf(s, chatID, mCarol); n != 1 {
		t.Fatalf("Кэрол после добавления = %d, want 1", n)
	}
	if n := unreadMentionsOf(s, chatID, mBob); n != 1 {
		t.Fatalf("Боб после повторной правки = %d, want 1 (не дважды)", n)
	}
	if f := lastMessageFlags(t, s, mCarol, "edit_message"); !f["mentioned"] || !f["media_unread"] {
		t.Fatalf("кадр правки Кэрол: %v", f)
	}

	if _, err := in.EditMessage(ctx, chatID, m.ID, mAlice, "только @carol_x", nil); err != nil {
		t.Fatalf("edit 2: %v", err)
	}
	if n := unreadMentionsOf(s, chatID, mBob); n != 0 {
		t.Fatalf("Боб после снятия = %d, want 0", n)
	}
	if f := lastMessageFlags(t, s, mBob, "edit_message"); f["mentioned"] || f["media_unread"] {
		t.Fatalf("кадр правки Бобу после снятия: %v", f)
	}
	if n := unreadMentionsOf(s, chatID, mCarol); n != 1 {
		t.Fatalf("Кэрол после второй правки = %d, want 1", n)
	}
}

// Пересылка: упоминание в тексте копии считается у участников целевого чата.
func TestMention_ForwardCountsTargetMembers(t *testing.T) {
	in, s, chatID := mentionGroup(t)
	ctx := context.Background()
	saved, _ := in.CreatePrivateChat(ctx, mAlice, 99)
	src, _ := in.Send(ctx, SendInput{ChatID: saved, SenderID: mAlice, Text: "@bob_petrov глянь"})

	out, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: saved, ToChatID: chatID, MsgIDs: []int64{src.ID}, SenderID: mAlice})
	if err != nil || len(out) != 1 {
		t.Fatalf("forward: %v %v", out, err)
	}
	if n := unreadMentionsOf(s, chatID, mBob); n != 1 {
		t.Fatalf("Боб после пересылки = %d, want 1", n)
	}
	if n := unreadMentionsOf(s, chatID, mAlice); n != 0 {
		t.Fatalf("отправитель = %d, want 0", n)
	}
	if f := lastMessageFlags(t, s, mBob, "new_message"); !f["mentioned"] || !f["media_unread"] {
		t.Fatalf("кадр пересылки Бобу: %v", f)
	}
}

// Прочтение содержимого (readMessageContents) гасит «непрочитано» упоминания у
// зрителя: счётчик −1, mentioned остаётся, кадр media_read — только ему.
func TestMention_ReadContents(t *testing.T) {
	in, s, chatID := mentionGroup(t)
	ctx := context.Background()
	m, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: mAlice, Text: "@bob_petrov @carol_x"})
	carolBefore := len(s.updates[mCarol])

	if err := in.ReadMedia(ctx, chatID, mBob, m.ID); err != nil {
		t.Fatalf("ReadMedia: %v", err)
	}
	if n := unreadMentionsOf(s, chatID, mBob); n != 0 {
		t.Fatalf("Боб после прочтения содержимого = %d, want 0", n)
	}
	if n := unreadMentionsOf(s, chatID, mCarol); n != 1 {
		t.Fatalf("Кэрол = %d, want 1 (прочтение чужое)", n)
	}
	ups := s.updates[mBob]
	if last := ups[len(ups)-1]; last.Type != "media_read" {
		t.Fatalf("последний кадр Боба = %s, want media_read", last.Type)
	}
	if len(s.updates[mCarol]) != carolBefore {
		t.Fatalf("Кэрол получила кадр чужого прочтения")
	}
	if f := wireFlags(t, in, mBob, m); !f["mentioned"] || f["media_unread"] {
		t.Fatalf("история Боба: %v", f)
	}
	// Повтор — no-op.
	n := len(s.updates[mBob])
	if err := in.ReadMedia(ctx, chatID, mBob, m.ID); err != nil {
		t.Fatalf("ReadMedia 2: %v", err)
	}
	if len(s.updates[mBob]) != n {
		t.Fatalf("повторное прочтение дало кадр")
	}
}
