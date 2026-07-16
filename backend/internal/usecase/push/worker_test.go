package push

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestWorker_SendsPrunes410AndAcks(t *testing.T) {
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), Job{RecipientID: 7, ChatID: 3, MsgID: 100, Seq: 5, SenderID: 9, Text: "hi", Preview: true})

	subs := &fakeSubs{byUser: map[int64][]domain.PushSubscription{
		7: {
			{Endpoint: "good", P256dh: "p1", Auth: "a1"},
			{Endpoint: "gone", P256dh: "p2", Auth: "a2"},
		},
	}}
	sender := &fakeSender{
		status:    http.StatusCreated,
		statusFor: map[string]int{"gone": http.StatusGone},
	}
	enrich := &fakeEnricher{
		names:  map[int64]string{9: "Alice"},
		badges: map[int64]int{7: 4},
	}
	w := NewWorker(q, subs, sender, enrich)

	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}

	if len(sender.sent) != 2 {
		t.Fatalf("expected 2 sends, got %d", len(sender.sent))
	}
	// 410 endpoint pruned.
	if len(subs.deleted) != 1 || subs.deleted[0] != "gone" {
		t.Fatalf("expected 'gone' pruned, got %v", subs.deleted)
	}
	// Acked => queue empty.
	if len(q.jobs) != 0 {
		t.Fatalf("expected queue empty after ack, got %d", len(q.jobs))
	}
	// Payload shape.
	var got map[string]any
	if err := json.Unmarshal(sender.sent[0].payload, &got); err != nil {
		t.Fatalf("payload unmarshal: %v", err)
	}
	if got["text"] != "hi" {
		t.Fatalf("payload text = %v", got["text"])
	}
	if s, _ := got["sender"].(map[string]any); s == nil || s["name"] != "Alice" {
		t.Fatalf("payload sender = %v", got["sender"])
	}
	if got["badge"].(float64) != 4 {
		t.Fatalf("payload badge = %v", got["badge"])
	}
	if got["chat_id"].(float64) != 3 || got["msg_id"].(float64) != 100 || got["seq"].(float64) != 5 {
		t.Fatalf("payload ids = %v", got)
	}
}

func TestWorker_TransientSubLoadErrorNotAcked(t *testing.T) {
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), Job{RecipientID: 7})

	subs := &fakeSubs{forErr: errors.New("db down")}
	sender := &fakeSender{status: http.StatusCreated}
	w := NewWorker(q, subs, sender, &fakeEnricher{})

	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}
	if len(sender.sent) != 0 {
		t.Fatalf("expected no sends on sub-load error, got %d", len(sender.sent))
	}
	// handle returned false => Ack must NOT have been called (the real Queue
	// then keeps the message pending for redelivery; at-least-once).
	if len(q.acked) != 0 {
		t.Fatalf("expected no ack on transient error, got %v", q.acked)
	}
}

func TestWorker_NoSubscriptionsAcks(t *testing.T) {
	q := &fakeQueue{}
	_ = q.Enqueue(context.Background(), Job{RecipientID: 7})

	subs := &fakeSubs{byUser: map[int64][]domain.PushSubscription{}}
	sender := &fakeSender{status: http.StatusCreated}
	w := NewWorker(q, subs, sender, &fakeEnricher{})

	if err := w.ProcessBatch(context.Background()); err != nil {
		t.Fatalf("ProcessBatch: %v", err)
	}
	if len(sender.sent) != 0 {
		t.Fatalf("expected no sends, got %d", len(sender.sent))
	}
	if len(q.jobs) != 0 {
		t.Fatalf("expected ack (empty queue), got %d", len(q.jobs))
	}
}
