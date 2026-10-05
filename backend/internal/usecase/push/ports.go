// Package push is the web-push application logic (notifier + worker + ports).
package push

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

const QueueStream = "push:queue"

// Job is enqueued on a new message for an offline, non-muted recipient.
type Job struct {
	RecipientID int64 `json:"recipient_id"`
	// ChatID — ВНУТРЕННИЙ чат: нужен только гейту уведомлений (ShouldNotify).
	// Наружу, в тело пуша, уезжает PeerID — ключ пира глазами ПОЛУЧАТЕЛЯ.
	ChatID int64         `json:"chat_id"`
	PeerID domain.PeerID `json:"peer_id"`
	// Seq — НОМЕР сообщения в чате: то самое число, которым сообщение
	// адресуется наружу (пара «пир + номер»). Глобального msg_id рядом больше
	// нет — задание, застрявшее в очереди с прошлой версии, несло оба поля, так
	// что старые задания читаются этим кодом без потерь.
	Seq      int64 `json:"seq"`
	SenderID int64 `json:"sender_id"`
	// Title — заголовок пуша, если он не имя автора: у поста канала это
	// название канала (автор поста у канала скрыт). Пусто — имя автора.
	Title   string `json:"title,omitempty"`
	Text    string `json:"text"`
	Preview bool   `json:"preview"` // Message Preview: включать ли текст в пуш
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
	// OnlineMany — кто из userIDs онлайн, одним проходом (батч пуша канала).
	OnlineMany(ctx context.Context, userIDs []int64) (map[int64]bool, error)
}

type NotifyChecker interface {
	// ShouldNotify — гейт пуша: per-chat mute (навсегда или до muted_until)
	// имеет приоритет; иначе глобальные настройки по типу чата
	// (notify_settings). preview — включать ли текст сообщения.
	// Не участник чата → notify=false.
	ShouldNotify(ctx context.Context, chatID, userID int64) (notify, preview bool, err error)
	// NotifyTargets — то же решение пачкой: кому из userIDs пушить (ключ
	// карты) и с текстом ли (значение). Не участник и замьюченный — не в карте.
	NotifyTargets(ctx context.Context, chatID int64, userIDs []int64) (map[int64]bool, error)
}

type Enricher interface {
	SenderName(ctx context.Context, userID int64) (string, error)
	UnreadBadge(ctx context.Context, userID int64) (int, error)
}
