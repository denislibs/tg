package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// stubPrivacy — PrivacyChecker для read-time: owner из hidden скрывает своё
// read-time от всех (взаимность — обе стороны должны делиться).
type stubPrivacy struct{ hidden map[int64]bool }

func (p stubPrivacy) Check(_ context.Context, ownerID, _ int64, key domain.PrivacyKey) (bool, error) {
	if key == domain.PrivacyReadTime && p.hidden[ownerID] {
		return false, nil
	}
	return true, nil
}

func (p stubPrivacy) VisibleMap(_ context.Context, _ int64, ownerIDs []int64, _ domain.PrivacyKey) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range ownerIDs {
		out[id] = true
	}
	return out, nil
}

// Исходящее прочитанное сообщение в приватном чате → отдаётся время прочтения.
func TestOutboxReadDate_ReturnsPeerReadTime(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})

	// b ещё не прочитал → read-date недоступна.
	if _, err := in.OutboxReadDate(ctx, chatID, msg.ID, a); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("before read: want ErrNotFound, got %v", err)
	}

	if err := in.MarkRead(ctx, chatID, b, msg.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	at, err := in.OutboxReadDate(ctx, chatID, msg.ID, a)
	if err != nil {
		t.Fatalf("OutboxReadDate: %v", err)
	}
	if at.IsZero() {
		t.Fatal("read date is zero after peer read the message")
	}
}

// Чужое (входящее) сообщение read-date не имеет — только для исходящих.
func TestOutboxReadDate_IncomingRejected(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: b, Text: "yo"})
	_ = in.MarkRead(ctx, chatID, a, msg.Seq)

	if _, err := in.OutboxReadDate(ctx, chatID, msg.ID, a); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("incoming msg: want ErrNotFound, got %v", err)
	}
}

// Взаимность: если получатель скрыл read-time — отправитель не видит (403);
// так же если отправитель скрыл своё read-time.
func TestOutboxReadDate_Reciprocity(t *testing.T) {
	ctx := context.Background()
	const a, b int64 = 1, 2

	// b (получатель) скрыл read-time → a не видит.
	in, _ := newInteractor()
	in.SetPrivacy(stubPrivacy{hidden: map[int64]bool{b: true}})
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	_ = in.MarkRead(ctx, chatID, b, msg.Seq)
	if _, err := in.OutboxReadDate(ctx, chatID, msg.ID, a); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("peer hid read-time: want ErrForbidden, got %v", err)
	}

	// a (отправитель) скрыл своё read-time → тоже не видит чужое.
	in2, _ := newInteractor()
	in2.SetPrivacy(stubPrivacy{hidden: map[int64]bool{a: true}})
	chatID2, _ := in2.CreatePrivateChat(ctx, a, b)
	msg2, _ := in2.Send(ctx, SendInput{ChatID: chatID2, SenderID: a, Text: "hi"})
	_ = in2.MarkRead(ctx, chatID2, b, msg2.Seq)
	if _, err := in2.OutboxReadDate(ctx, chatID2, msg2.ID, a); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("I hid my read-time: want ErrForbidden, got %v", err)
	}
}
