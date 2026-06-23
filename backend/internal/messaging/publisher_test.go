package messaging

import (
	"context"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

type capturedFrame struct {
	userID int64
	frame  []byte
}

type fakePublisher struct {
	mu     sync.Mutex
	frames []capturedFrame
}

func (p *fakePublisher) PublishToUser(_ context.Context, userID int64, f []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.frames = append(p.frames, capturedFrame{userID, append([]byte(nil), f...)})
	return nil
}

func (p *fakePublisher) countFor(userID int64) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, f := range p.frames {
		if f.userID == userID {
			n++
		}
	}
	return n
}

type fakeNotifier struct {
	mu         sync.Mutex
	recipients []int64
}

func (n *fakeNotifier) NotifyNewMessage(_ context.Context, recipientID, _, _, _, _ int64, _ string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.recipients = append(n.recipients, recipientID)
}

func TestSend_NotifiesNonSenderRecipients(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	nf := &fakeNotifier{}
	s.SetNotifier(nf)
	ctx := context.Background()
	a := seedUser(t, pool, "+840")
	b := seedUser(t, pool, "+841")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	if _, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	nf.mu.Lock()
	defer nf.mu.Unlock()
	if len(nf.recipients) != 1 || nf.recipients[0] != b {
		t.Fatalf("notifier recipients = %v; want [%d]", nf.recipients, b)
	}
}

func TestSend_PublishesToAllMembers(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	pub := &fakePublisher{}
	s.SetPublisher(pub)
	ctx := context.Background()
	a := seedUser(t, pool, "+810")
	b := seedUser(t, pool, "+811")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	if _, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi", ClientMsgID: "c1"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if pub.countFor(a) != 1 || pub.countFor(b) != 1 {
		t.Fatalf("expected 1 frame each; got a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}

	// Duplicate send publishes nothing extra.
	if _, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi", ClientMsgID: "c1"}); err != nil {
		t.Fatalf("dup Send: %v", err)
	}
	if pub.countFor(b) != 1 {
		t.Fatalf("duplicate published again: b=%d", pub.countFor(b))
	}
}

func TestMarkRead_PublishesRead(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	pub := &fakePublisher{}
	s.SetPublisher(pub)
	ctx := context.Background()
	a := seedUser(t, pool, "+820")
	b := seedUser(t, pool, "+821")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)
	_, _ = s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "1"})
	pub.frames = nil // reset after send

	if err := s.MarkRead(ctx, chatID, b, 1); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if pub.countFor(a) != 1 || pub.countFor(b) != 1 {
		t.Fatalf("read frame fan-out wrong: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}
}

func TestTyping_PublishesToOthers(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	pub := &fakePublisher{}
	s.SetPublisher(pub)
	ctx := context.Background()
	a := seedUser(t, pool, "+830")
	b := seedUser(t, pool, "+831")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	if err := s.Typing(ctx, chatID, a); err != nil {
		t.Fatalf("Typing: %v", err)
	}
	if pub.countFor(b) != 1 || pub.countFor(a) != 0 {
		t.Fatalf("typing should go to others only: a=%d b=%d", pub.countFor(a), pub.countFor(b))
	}
}
