package redis

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	usecasepush "github.com/messenger-denis/backend/internal/usecase/push"
)

func TestQueue_EnqueueConsumeAck(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	q := NewQueue(rdb)
	job := usecasepush.Job{RecipientID: 7, ChatID: 3, Seq: 5, SenderID: 9, Text: "hi"}

	if err := q.Enqueue(ctx, job); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}

	jobs, err := q.Consume(ctx, 10, 0)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected 1 job, got %d", len(jobs))
	}
	if jobs[0].Job != job {
		t.Fatalf("consumed job = %+v, want %+v", jobs[0].Job, job)
	}
	if jobs[0].ID == "" {
		t.Fatalf("expected non-empty queue id")
	}

	if err := q.Ack(ctx, jobs[0].ID); err != nil {
		t.Fatalf("Ack: %v", err)
	}

	// After ack, nothing pending.
	pending, err := rdb.XPending(ctx, usecasepush.QueueStream, consumerGroup).Result()
	if err != nil {
		t.Fatalf("XPending: %v", err)
	}
	if pending.Count != 0 {
		t.Fatalf("expected 0 pending after ack, got %d", pending.Count)
	}
}

func TestQueue_ConsumeEmpty(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	q := NewQueue(rdb)
	jobs, err := q.Consume(ctx, 10, 0)
	if err != nil {
		t.Fatalf("Consume empty: %v", err)
	}
	if len(jobs) != 0 {
		t.Fatalf("expected empty slice, got %d", len(jobs))
	}
}

// Пачка заданий пуша поста канала уходит конвейером и читается как обычные.
func TestQueue_EnqueueManyPipelined(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	q := NewQueue(rdb)
	jobs := make([]usecasepush.Job, 0, enqueueChunk+5)
	for k := range enqueueChunk + 5 {
		jobs = append(jobs, usecasepush.Job{RecipientID: int64(k + 1), ChatID: 3, Seq: 5, Title: "Канал"})
	}
	if err := q.EnqueueMany(ctx, jobs); err != nil {
		t.Fatalf("EnqueueMany: %v", err)
	}
	if n := rdb.XLen(ctx, usecasepush.QueueStream).Val(); n != int64(len(jobs)) {
		t.Fatalf("в потоке %d заданий, want %d", n, len(jobs))
	}
	got, err := q.Consume(ctx, 2, 0)
	if err != nil || len(got) != 2 || got[0].Job != jobs[0] {
		t.Fatalf("Consume = %+v %v", got, err)
	}
}
