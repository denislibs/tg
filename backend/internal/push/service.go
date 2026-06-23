package push

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// QueueStream is the Redis Stream push jobs are enqueued on.
const QueueStream = "push:queue"

// Job is a queued push (enriched by the worker before sending).
type Job struct {
	RecipientID int64  `json:"recipient_id"`
	ChatID      int64  `json:"chat_id"`
	MsgID       int64  `json:"msg_id"`
	Seq         int64  `json:"seq"`
	SenderID    int64  `json:"sender_id"`
	Text        string `json:"text"`
}

// Service implements messaging.Notifier: it pushes only to offline, non-muted recipients.
type Service struct {
	rdb  *redis.Client
	pool *pgxpool.Pool
}

func NewService(rdb *redis.Client, pool *pgxpool.Pool) *Service {
	return &Service{rdb: rdb, pool: pool}
}

func (s *Service) NotifyNewMessage(ctx context.Context, recipientID, chatID, msgID, seq, senderID int64, text string) {
	// Online (has an active socket)? The WS layer already delivered it live.
	if n, _ := s.rdb.Exists(ctx, "presence:"+strconv.FormatInt(recipientID, 10)).Result(); n > 0 {
		return
	}
	// Muted this chat? Don't push.
	var muted bool
	if err := s.pool.QueryRow(ctx,
		`SELECT muted FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, recipientID).Scan(&muted); err != nil || muted {
		return
	}
	job := Job{RecipientID: recipientID, ChatID: chatID, MsgID: msgID, Seq: seq, SenderID: senderID, Text: text}
	payload, _ := json.Marshal(job)
	_ = s.rdb.XAdd(ctx, &redis.XAddArgs{Stream: QueueStream, Values: map[string]any{"job": payload}}).Err()
}
