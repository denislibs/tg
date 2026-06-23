package push

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const consumerGroup = "push-workers"

// Sender sends one encrypted Web Push. Returns the HTTP status from the push
// service (so the worker can prune 404/410).
type Sender interface {
	Send(ctx context.Context, sub Subscription, payload []byte) (status int, err error)
}

type Worker struct {
	rdb      *redis.Client
	pool     *pgxpool.Pool
	repo     *Repo
	sender   Sender
	consumer string
}

func NewWorker(rdb *redis.Client, pool *pgxpool.Pool, sender Sender) *Worker {
	return &Worker{rdb: rdb, pool: pool, repo: NewRepo(pool), sender: sender, consumer: "w1"}
}

// Run consumes the queue until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	_ = w.rdb.XGroupCreateMkStream(ctx, QueueStream, consumerGroup, "0").Err() // ignore BUSYGROUP
	for ctx.Err() == nil {
		if err := w.processBatch(ctx, 5*time.Second); err != nil && ctx.Err() == nil {
			time.Sleep(time.Second) // back off on transient errors
		}
	}
}

// processBatch reads and handles up to a few pending jobs. Exposed for tests.
func (w *Worker) processBatch(ctx context.Context, block time.Duration) error {
	res, err := w.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group: consumerGroup, Consumer: w.consumer,
		Streams: []string{QueueStream, ">"}, Count: 10, Block: block,
	}).Result()
	if errors.Is(err, redis.Nil) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, stream := range res {
		for _, msg := range stream.Messages {
			w.handle(ctx, msg)
			w.rdb.XAck(ctx, QueueStream, consumerGroup, msg.ID)
		}
	}
	return nil
}

func (w *Worker) handle(ctx context.Context, msg redis.XMessage) {
	raw, _ := msg.Values["job"].(string)
	var job Job
	if json.Unmarshal([]byte(raw), &job) != nil {
		return
	}
	subs, err := w.repo.SubscriptionsForUser(ctx, job.RecipientID)
	if err != nil || len(subs) == 0 {
		return
	}
	payload, _ := json.Marshal(w.buildPayload(ctx, job))
	for _, sub := range subs {
		status, err := w.sender.Send(ctx, sub, payload)
		if err == nil && (status == http.StatusNotFound || status == http.StatusGone) {
			_ = w.repo.DeleteByEndpoint(ctx, sub.Endpoint)
		}
	}
}

// buildPayload enriches the job with sender name + unread badge for the client.
func (w *Worker) buildPayload(ctx context.Context, job Job) map[string]any {
	var senderName string
	_ = w.pool.QueryRow(ctx, `SELECT display_name FROM users WHERE id=$1`, job.SenderID).Scan(&senderName)
	var badge int
	if err := w.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(unread_count),0) FROM chat_members WHERE user_id=$1`,
		job.RecipientID).Scan(&badge); errors.Is(err, pgx.ErrNoRows) {
		badge = 0
	}
	return map[string]any{
		"chat_id": job.ChatID, "msg_id": job.MsgID, "seq": job.Seq,
		"sender": map[string]any{"name": senderName},
		"text":   job.Text, "badge": badge,
	}
}
