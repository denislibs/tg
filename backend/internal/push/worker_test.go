package push

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"
)

type fakeSender struct {
	mu     sync.Mutex
	sent   [][]byte
	status int
}

func (f *fakeSender) Send(_ context.Context, _ Subscription, payload []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, payload)
	if f.status == 0 {
		return http.StatusCreated, nil
	}
	return f.status, nil
}

func TestWorker_SendsAndPrunesGone(t *testing.T) {
	s, mr, rdb, a, b, chatID := setup(t)
	defer mr.Close()
	repo := NewRepo(s.pool)

	// Give b a device + subscription.
	var deviceID int64
	_ = s.pool.QueryRow(context.Background(), `INSERT INTO devices (user_id, token_hash) VALUES ($1,'hb') RETURNING id`, b).Scan(&deviceID)
	_ = repo.AddSubscription(context.Background(), deviceID, Subscription{Endpoint: "https://push/b", P256dh: "p", Auth: "x"})

	// Enqueue a job (b offline, not muted).
	s.NotifyNewMessage(context.Background(), b, chatID, 10, 1, a, "hello")

	sender := &fakeSender{status: http.StatusGone} // simulate expired subscription
	w := NewWorker(rdb, s.pool, sender)
	_ = rdb.XGroupCreateMkStream(context.Background(), QueueStream, consumerGroup, "0").Err()
	if err := w.processBatch(context.Background(), 100*time.Millisecond); err != nil {
		t.Fatalf("processBatch: %v", err)
	}

	sender.mu.Lock()
	n := len(sender.sent)
	sender.mu.Unlock()
	if n != 1 {
		t.Fatalf("expected 1 push sent, got %d", n)
	}
	// 410 Gone → subscription pruned.
	subs, _ := repo.SubscriptionsForUser(context.Background(), b)
	if len(subs) != 0 {
		t.Fatalf("expected subscription pruned after 410, got %d", len(subs))
	}

	// The job was ACKed → no pending entries remain.
	pending, err := rdb.XPending(context.Background(), QueueStream, consumerGroup).Result()
	if err != nil {
		t.Fatalf("xpending: %v", err)
	}
	if pending.Count != 0 {
		t.Fatalf("expected 0 pending entries after ack, got %d", pending.Count)
	}
}
