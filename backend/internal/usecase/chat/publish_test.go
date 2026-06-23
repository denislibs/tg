package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestSend_PublishesToAllMembers(t *testing.T) {
	in, _ := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi", ClientMsgID: "c1"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if pub.countFor(a) != 1 || pub.countFor(b) != 1 {
		t.Fatalf("expected 1 frame each; got a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}

	// Duplicate send publishes nothing extra.
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi", ClientMsgID: "c1"}); err != nil {
		t.Fatalf("dup Send: %v", err)
	}
	if pub.countFor(b) != 1 {
		t.Fatalf("duplicate published again: b=%d", pub.countFor(b))
	}
}

func TestSend_NotifiesNonSenderRecipients(t *testing.T) {
	in, _ := newInteractor()
	nf := &fakeNotifier{}
	in.SetNotifier(nf)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	nf.mu.Lock()
	defer nf.mu.Unlock()
	if len(nf.recipients) != 1 || nf.recipients[0] != b {
		t.Fatalf("notifier recipients = %v; want [%d]", nf.recipients, b)
	}
}

func TestMarkRead_PublishesRead(t *testing.T) {
	in, _ := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})
	pub.reset()

	if err := in.MarkRead(ctx, chatID, b, 1); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if pub.countFor(a) != 1 || pub.countFor(b) != 1 {
		t.Fatalf("read frame fan-out wrong: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}

	// A no-op re-read (no advance) must not publish.
	pub.reset()
	if err := in.MarkRead(ctx, chatID, b, 1); err != nil {
		t.Fatalf("MarkRead re-read: %v", err)
	}
	if pub.countFor(a) != 0 || pub.countFor(b) != 0 {
		t.Fatalf("stale re-read should not publish: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}
}

func TestTyping_PublishesToOthers(t *testing.T) {
	in, _ := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if err := in.Typing(ctx, chatID, a); err != nil {
		t.Fatalf("Typing: %v", err)
	}
	if pub.countFor(b) != 1 || pub.countFor(a) != 0 {
		t.Fatalf("typing should go to others only: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}
}

func TestReact_FanoutAndAggregate(t *testing.T) {
	in, _ := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	pub.reset() // ignore the send fan-out

	if err := in.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React add: %v", err)
	}
	if pub.countFor(a) != 1 || pub.countFor(b) != 1 {
		t.Fatalf("reaction fan-out wrong: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}
	counts, _ := in.ReactionsOf(ctx, chatID, msg.ID, a)
	if len(counts) != 1 || counts[0].Emoji != "🔥" || counts[0].Count != 1 {
		t.Fatalf("counts = %+v", counts)
	}

	// The reaction reaches the pts log: a syncs from after the message (pts=1).
	diff, err := in.GetDifference(ctx, a, 1)
	if err != nil {
		t.Fatalf("GetDifference: %v", err)
	}
	if len(diff.OtherUpdates) != 1 || len(diff.NewMessages) != 0 {
		t.Fatalf("expected 1 reaction in other_updates, got new=%d other=%d", len(diff.NewMessages), len(diff.OtherUpdates))
	}

	// Remove it.
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", false); err != nil {
		t.Fatalf("React remove: %v", err)
	}
	counts, _ = in.ReactionsOf(ctx, chatID, msg.ID, a)
	if len(counts) != 0 {
		t.Fatalf("expected no reactions after remove, got %+v", counts)
	}
}

func TestReact_Rejects(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})

	// Empty emoji rejected.
	if err := in.React(ctx, chatID, msg.ID, a, "", true); !errors.Is(err, domain.ErrBadReaction) {
		t.Fatalf("expected ErrBadReaction, got %v", err)
	}
	// Non-member rejected.
	if err := in.React(ctx, chatID, msg.ID, 999, "🔥", true); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-member, got %v", err)
	}
	// Wrong chat id for the message rejected.
	if err := in.React(ctx, chatID+999, msg.ID, a, "🔥", true); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for mismatched chat, got %v", err)
	}
}

func TestCanAccessMedia(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b, c int64 = 1, 2, 3
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	const mediaID int64 = 100
	s.seedMedia(mediaID, a)
	_, _ = in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", MediaID: ptr(mediaID)})

	// Owner can access.
	if ok, _ := in.CanAccessMedia(ctx, a, mediaID); !ok {
		t.Fatal("owner should access media")
	}
	// Chat member can access.
	if ok, _ := in.CanAccessMedia(ctx, b, mediaID); !ok {
		t.Fatal("chat member should access media")
	}
	// Stranger cannot.
	if ok, _ := in.CanAccessMedia(ctx, c, mediaID); ok {
		t.Fatal("stranger should not access media")
	}
}
