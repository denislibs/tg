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
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: src, Seq: 1, SenderID: 2, Type: "text", Text: "исходный текст"})
	// Целевой чат: отправитель 1 + пользователь 3.
	dst, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)

	// Адрес оригинала — ПАРА: номер в чате + ключ пира этого чата. Один номер
	// сообщение не адресует: тот же номер есть в каждом чате.
	msg, err := in.Send(ctx, SendInput{
		ChatID: dst, SenderID: 1, Type: "text", Text: "мой ответ",
		ReplyToID: &orig.Seq, ReplyToPeerID: &src,
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
	// В кадре ссылка едет messageReplyHeader.
	wire, _ := in.messageUpdatePayload(ctx, msg)["message"].(map[string]any)
	reply, _ := wire["reply_to"].(map[string]any)
	// Источник — ПРИВАТНЫЙ чат: публичного ключа пира у него нет, поэтому
	// ссылки в кадре быть не должно (иначе наружу уехал бы внутренний chats.id
	// — ровно то, что шаг B из провода убрал). Недоступный оригинал выражается
	// атрибуцией автора reply_from, а не снимком текста рядом.
	if _, ok := reply["reply_to_peer_id"]; ok {
		t.Fatalf("приватный источник отдал ссылку на пир: %v", reply["reply_to_peer_id"])
	}
	from, _ := reply["reply_from"].(map[string]any)
	if from["from_name"] != "Автор Оригинала" {
		t.Fatalf("reply_from = %v", reply["reply_from"])
	}
	if _, ok := reply["reply_snapshot_text"]; ok {
		t.Error("снимок чужого текста всё ещё уезжает в кадре")
	}
}

func TestReplyCrossChat_MediaSnapshotLabel(t *testing.T) {
	in, s, fg := newReplyTestInteractor()
	ctx := context.Background()
	fg.users[2] = domain.UserReal{ID: 2, FirstName: "Автор"}
	src, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(50)
	s.seedMedia(mediaID, 2)
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: src, Seq: 1, SenderID: 2, Type: "photo", MediaID: &mediaID})
	dst, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)

	msg, err := in.Send(ctx, SendInput{
		ChatID: dst, SenderID: 1, Type: "text", Text: "re",
		ReplyToID: &orig.Seq, ReplyToPeerID: &src,
	})
	if err != nil {
		t.Fatalf("reply to media: %v", err)
	}
	if msg.ReplySnapshotName != "Автор" {
		t.Fatalf("атрибуция автора недоступного оригинала = %q", msg.ReplySnapshotName)
	}
}

func TestReplyCrossChat_NoAccessForbidden(t *testing.T) {
	in, s, fg := newReplyTestInteractor()
	ctx := context.Background()
	fg.users[2] = domain.UserReal{ID: 2, FirstName: "Автор"}

	// Исходный чат между 2 и 4 — отправитель 1 НЕ участник.
	src, _ := fakeChats{s}.CreatePrivate(ctx, 2, 4)
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: src, Seq: 1, SenderID: 2, Type: "text", Text: "секрет"})
	dst, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)

	// Клиент называет чужой чат явно (иначе номер разрешился бы в СВОЁМ чате и
	// до чужого не дотянулся бы вовсе) — членство проверяется, доступа нет.
	_, err := in.Send(ctx, SendInput{
		ChatID: dst, SenderID: 1, Type: "text", Text: "подсмотрел",
		ReplyToID: &orig.Seq, ReplyToPeerID: &src,
	})
	if err != domain.ErrForbidden {
		t.Fatalf("want ErrForbidden without source access, got %v", err)
	}

	// Без пира тот же номер адресует сообщение ЭТОГО чата, и утечь нечему:
	// чужой чат из такого адреса недостижим в принципе.
	sent, err := in.Send(ctx, SendInput{
		ChatID: dst, SenderID: 1, Type: "text", Text: "без пира",
		ReplyToID: &orig.Seq,
	})
	if err != nil {
		t.Fatalf("reply without peer: %v", err)
	}
	if sent.ReplyToPeerID != nil || sent.ReplySnapshotName != "" {
		t.Fatalf("номер без пира дотянулся до чужого чата: peer=%v snapshot=%q",
			sent.ReplyToPeerID, sent.ReplySnapshotName)
	}
}

func TestReply_SameChatUnchanged(t *testing.T) {
	in, s, _ := newReplyTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: cid, Seq: 1, SenderID: 2, Type: "text", Text: "оригинал"})

	// Обычный reply (без peer id) — снимки пустые, peer id nil.
	msg, err := in.Send(ctx, SendInput{
		ChatID: cid, SenderID: 1, Type: "text", Text: "ответ", ReplyToID: &orig.Seq,
	})
	if err != nil {
		t.Fatalf("normal reply: %v", err)
	}
	if msg.ReplyToPeerID != nil || msg.ReplySnapshotName != "" {
		t.Fatalf("normal reply should have no snapshot: peer=%v name=%q",
			msg.ReplyToPeerID, msg.ReplySnapshotName)
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
	orig, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: foreign, Seq: 1, SenderID: 2, Type: "text", Text: "СЕКРЕТ ЧУЖОГО ЧАТА"})
	// Целевой чат с локальным оригиналом (обычный reply — должен гидрироваться).
	dst, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)
	local, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: dst, Seq: 1, SenderID: 3, Type: "text", Text: "локальный"})

	peer := foreign
	msgs := []domain.Message{
		// (a) кросс-чат-ответ: снимок есть, ReplyToPeerID выставлен.
		{ID: 100, ChatID: dst, SenderID: 1, Type: "text", Text: "ответ1",
			ReplyToID: &orig.Seq, ReplyToPeerID: &peer,
			ReplySnapshotName: "Автор"},
		// (b) тот же номер БЕЗ пира: выборка идёт по (chat_id, seq) этого чата,
		// поэтому оригинал чужого чата недостижим — в нашем чате под этим
		// номером лежит своё сообщение (local).
		{ID: 101, ChatID: dst, SenderID: 1, Type: "text", Text: "ответ2", ReplyToID: &orig.Seq},
		// (c) обычный локальный reply — обязан гидрироваться.
		{ID: 102, ChatID: dst, SenderID: 1, Type: "text", Text: "ответ3", ReplyToID: &local.Seq},
	}
	if err := in.hydrateReplies(ctx, msgs); err != nil {
		t.Fatalf("hydrateReplies: %v", err)
	}
	if msgs[0].ReplyTo != nil {
		t.Fatalf("cross-chat reply must not hydrate ReplyTo, got %+v", msgs[0].ReplyTo)
	}
	if msgs[1].ReplyTo != nil && msgs[1].ReplyTo.Text == "СЕКРЕТ ЧУЖОГО ЧАТА" {
		t.Fatalf("foreign-chat original leaked into ReplyTo: %+v", msgs[1].ReplyTo)
	}
	if msgs[2].ReplyTo == nil || msgs[2].ReplyTo.Text != "локальный" {
		t.Fatalf("same-chat reply must hydrate ReplyTo, got %+v", msgs[2].ReplyTo)
	}
}
