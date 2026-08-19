package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// newReplyTestInteractor: fakeChats (хранит чаты/сообщения) + fakeGroupRepo
// (только для резолва имени автора через userCard).
func newReplyTestInteractor() (*Interactor, *store, *fakeGroupRepo) {
	s := newStore()
	fg := newFakeGroupRepo()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, fg, nil, nil, nil, nil)
	return in, s, fg
}

func TestReplyCrossChat_SavesPeerAndSnapshot(t *testing.T) {
	in, s, fg := newReplyTestInteractor()
	ctx := context.Background()
	fg.users[2] = domain.UserReal{ID: 2, FirstName: "Автор Оригинала"}

	// Исходный чат: автор 2 + отправитель 1 (у отправителя есть доступ).
	src, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: src, SenderID: 2, Type: "text", Text: "исходный текст"})
	// Целевой чат: отправитель 1 + пользователь 3.
	dst, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)

	// Клиент НЕ присылает reply_to_peer_id — сервер сам определяет кросс-чат по
	// фактическому чату оригинала (источник истины — orig.ChatID, не клиент).
	msg, err := in.Send(ctx, SendInput{
		ChatID: dst, SenderID: 1, Type: "text", Text: "мой ответ",
		ReplyToID: &orig.ID,
	})
	if err != nil {
		t.Fatalf("cross-chat reply: %v", err)
	}
	if msg.ReplyToPeerID == nil || *msg.ReplyToPeerID != src {
		t.Fatalf("reply_to_peer_id not saved: %v", msg.ReplyToPeerID)
	}
	if msg.ReplySnapshotName != "Автор Оригинала" {
		t.Fatalf("snapshot name = %q", msg.ReplySnapshotName)
	}
	if msg.ReplySnapshotText != "исходный текст" {
		t.Fatalf("snapshot text = %q", msg.ReplySnapshotText)
	}
	// В payload превью едет отдельными полями.
	p := in.messageUpdatePayload(ctx, msg)
	// Источник — ПРИВАТНЫЙ чат: публичного ключа пира у него нет, поэтому
	// ссылки в кадре быть не должно (иначе наружу уехал бы внутренний chats.id
	// — ровно то, что шаг B из провода убрал). Снимок превью при этом на месте.
	if _, ok := p["reply_to_peer_id"]; ok {
		t.Fatalf("приватный источник отдал ссылку на пир: %v", p["reply_to_peer_id"])
	}
	if p["reply_snapshot_name"] != "Автор Оригинала" || p["reply_snapshot_text"] != "исходный текст" {
		t.Fatalf("payload snapshot = %v / %v", p["reply_snapshot_name"], p["reply_snapshot_text"])
	}
}

func TestReplyCrossChat_MediaSnapshotLabel(t *testing.T) {
	in, s, fg := newReplyTestInteractor()
	ctx := context.Background()
	fg.users[2] = domain.UserReal{ID: 2, FirstName: "Автор"}
	src, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(50)
	s.seedMedia(mediaID, 2)
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: src, SenderID: 2, Type: "photo", MediaID: &mediaID})
	dst, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)

	msg, err := in.Send(ctx, SendInput{
		ChatID: dst, SenderID: 1, Type: "text", Text: "re",
		ReplyToID: &orig.ID,
	})
	if err != nil {
		t.Fatalf("reply to media: %v", err)
	}
	if msg.ReplySnapshotText != "Фото" {
		t.Fatalf("media snapshot label = %q, want Фото", msg.ReplySnapshotText)
	}
}

func TestReplyCrossChat_NoAccessForbidden(t *testing.T) {
	in, s, fg := newReplyTestInteractor()
	ctx := context.Background()
	fg.users[2] = domain.UserReal{ID: 2, FirstName: "Автор"}

	// Исходный чат между 2 и 4 — отправитель 1 НЕ участник.
	src, _ := fakeChats{s}.CreatePrivate(ctx, 2, 4)
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: src, SenderID: 2, Type: "text", Text: "секрет"})
	dst, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)

	// Дыра доступа: клиент шлёт reply_to_id на чужое сообщение и НЕ шлёт
	// reply_to_peer_id (или шлёт равный текущему чату). Раньше проверка членства
	// не срабатывала. Теперь кросс-чат детектится по orig.ChatID → forbidden.
	_, err := in.Send(ctx, SendInput{
		ChatID: dst, SenderID: 1, Type: "text", Text: "подсмотрел",
		ReplyToID: &orig.ID,
	})
	if err != domain.ErrForbidden {
		t.Fatalf("want ErrForbidden without source access, got %v", err)
	}
}

func TestReply_SameChatUnchanged(t *testing.T) {
	in, s, _ := newReplyTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: cid, SenderID: 2, Type: "text", Text: "оригинал"})

	// Обычный reply (без peer id) — снимки пустые, peer id nil.
	msg, err := in.Send(ctx, SendInput{
		ChatID: cid, SenderID: 1, Type: "text", Text: "ответ", ReplyToID: &orig.ID,
	})
	if err != nil {
		t.Fatalf("normal reply: %v", err)
	}
	if msg.ReplyToPeerID != nil || msg.ReplySnapshotName != "" || msg.ReplySnapshotText != "" {
		t.Fatalf("normal reply should have no snapshot: peer=%v name=%q text=%q",
			msg.ReplyToPeerID, msg.ReplySnapshotName, msg.ReplySnapshotText)
	}
}

// hydrateReplies не должен подтягивать РЕАЛЬНЫЙ оригинал чужого чата в ReplyTo:
// кросс-чат-ответ рисуется из снимка. Плюс defense-in-depth — даже без peer id
// оригинал из другого чата не просачивается (скоуп по chat_id).
func TestHydrateReplies_CrossChatNotLeaked(t *testing.T) {
	in, s, _ := newReplyTestInteractor()
	ctx := context.Background()

	// Чужой чат с секретным оригиналом (не должен утечь в ReplyTo).
	foreign, _ := fakeChats{s}.CreatePrivate(ctx, 2, 4)
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: foreign, SenderID: 2, Type: "text", Text: "СЕКРЕТ ЧУЖОГО ЧАТА"})
	// Целевой чат с локальным оригиналом (обычный reply — должен гидрироваться).
	dst, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)
	local, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: dst, SenderID: 3, Type: "text", Text: "локальный"})

	peer := foreign
	msgs := []domain.Message{
		// (a) кросс-чат-ответ: снимок есть, ReplyToPeerID выставлен.
		{ID: 100, ChatID: dst, SenderID: 1, Type: "text", Text: "ответ1",
			ReplyToID: &orig.ID, ReplyToPeerID: &peer,
			ReplySnapshotName: "Автор", ReplySnapshotText: "снимок"},
		// (b) defense-in-depth: peer id НЕ выставлен, но оригинал в чужом чате.
		{ID: 101, ChatID: dst, SenderID: 1, Type: "text", Text: "ответ2", ReplyToID: &orig.ID},
		// (c) обычный локальный reply — обязан гидрироваться.
		{ID: 102, ChatID: dst, SenderID: 1, Type: "text", Text: "ответ3", ReplyToID: &local.ID},
	}
	if err := in.hydrateReplies(ctx, msgs); err != nil {
		t.Fatalf("hydrateReplies: %v", err)
	}
	if msgs[0].ReplyTo != nil {
		t.Fatalf("cross-chat reply must not hydrate ReplyTo, got %+v", msgs[0].ReplyTo)
	}
	if msgs[1].ReplyTo != nil {
		t.Fatalf("foreign-chat original must not leak into ReplyTo, got %+v", msgs[1].ReplyTo)
	}
	if msgs[2].ReplyTo == nil || msgs[2].ReplyTo.Text != "локальный" {
		t.Fatalf("same-chat reply must hydrate ReplyTo, got %+v", msgs[2].ReplyTo)
	}
}
