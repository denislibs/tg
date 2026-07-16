// Package push is the web-push application logic (notifier + worker + ports).
package push

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

const QueueStream = "push:queue"

// Job is enqueued on a new message for an offline, non-muted recipient.
type Job struct {
	RecipientID int64  `json:"recipient_id"`
	ChatID      int64  `json:"chat_id"`
	MsgID       int64  `json:"msg_id"`
	Seq         int64  `json:"seq"`
	SenderID    int64  `json:"sender_id"`
	Text        string `json:"text"`
	Preview     bool   `json:"preview"` // Message Preview: включать ли текст в пуш
}

// QueuedJob is a Job plus its queue id (for ack).
type QueuedJob struct {
	ID  string
	Job Job
}

type SubRepo interface {
	Add(ctx context.Context, deviceID int64, s domain.PushSubscription) error
	ForUser(ctx context.Context, userID int64) ([]domain.PushSubscription, error)
	DeleteByEndpoint(ctx context.Context, endpoint string) error
}

type Queue interface {
	Enqueue(ctx context.Context, j Job) error
	Consume(ctx context.Context, max int, blockMS int) ([]QueuedJob, error) // empty slice if none
	Ack(ctx context.Context, id string) error
}

// Sender sends one encrypted push; returns the HTTP status (for 404/410 pruning).
type Sender interface {
	Send(ctx context.Context, sub domain.PushSubscription, payload []byte) (status int, err error)
}

type OnlineChecker interface {
	IsOnline(ctx context.Context, userID int64) (bool, error)
}

type NotifyChecker interface {
	// ShouldNotify — гейт пуша: per-chat mute (навсегда или до muted_until)
	// имеет приоритет; иначе глобальные настройки по типу чата
	// (notify_settings). preview — включать ли текст сообщения.
	// Не участник чата → notify=false.
	ShouldNotify(ctx context.Context, chatID, userID int64) (notify, preview bool, err error)
}

type Enricher interface {
	SenderName(ctx context.Context, userID int64) (string, error)
	UnreadBadge(ctx context.Context, userID int64) (int, error)
}
