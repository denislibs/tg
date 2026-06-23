// Package redis provides Redis-Streams adapters for the push usecase queue.
package redis

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"

	usecasepush "github.com/messenger-denis/backend/internal/usecase/push"
)

const consumerGroup = "push-workers"

// Queue implements usecasepush.Queue over a Redis Stream + consumer group.
type Queue struct {
	rdb      *goredis.Client
	consumer string
}

func NewQueue(rdb *goredis.Client) *Queue { return &Queue{rdb: rdb, consumer: "w1"} }

var _ usecasepush.Queue = (*Queue)(nil)

// Enqueue appends a job (JSON under the "job" field) to the stream.
func (q *Queue) Enqueue(ctx context.Context, j usecasepush.Job) error {
	payload, err := json.Marshal(j)
	if err != nil {
		return err
	}
	return q.rdb.XAdd(ctx, &goredis.XAddArgs{
		Stream: usecasepush.QueueStream,
		Values: map[string]any{"job": payload},
	}).Err()
}

// Consume reads up to max new messages, blocking up to blockMS milliseconds.
// Returns an empty slice when nothing is pending.
func (q *Queue) Consume(ctx context.Context, max int, blockMS int) ([]usecasepush.QueuedJob, error) {
	// Ensure the consumer group exists (ignore BUSYGROUP on re-create).
	_ = q.rdb.XGroupCreateMkStream(ctx, usecasepush.QueueStream, consumerGroup, "0").Err()

	args := &goredis.XReadGroupArgs{
		Group:    consumerGroup,
		Consumer: q.consumer,
		Streams:  []string{usecasepush.QueueStream, ">"},
		Count:    int64(max),
	}
	// blockMS <= 0 means non-blocking (return immediately if nothing is ready);
	// a positive value blocks up to that many milliseconds. (Block:0 in Redis
	// would block forever, which is never what callers want here.)
	if blockMS > 0 {
		args.Block = time.Duration(blockMS) * time.Millisecond
	} else {
		args.Block = -1 // negative disables blocking in go-redis
	}
	res, err := q.rdb.XReadGroup(ctx, args).Result()
	if errors.Is(err, goredis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var out []usecasepush.QueuedJob
	for _, stream := range res {
		for _, msg := range stream.Messages {
			raw, _ := msg.Values["job"].(string)
			var job usecasepush.Job
			if json.Unmarshal([]byte(raw), &job) != nil {
				// Poison pill — still surface it so the worker can ack/discard.
				out = append(out, usecasepush.QueuedJob{ID: msg.ID})
				continue
			}
			out = append(out, usecasepush.QueuedJob{ID: msg.ID, Job: job})
		}
	}
	return out, nil
}

// Ack acknowledges a delivered message.
func (q *Queue) Ack(ctx context.Context, id string) error {
	return q.rdb.XAck(ctx, usecasepush.QueueStream, consumerGroup, id).Err()
}
