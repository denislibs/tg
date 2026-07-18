package domain

import "time"

// ScheduledMessage — запланированное сообщение (Telegram scheduled messages):
// лежит в отдельной очереди и попадает в историю чата только в момент SendAt.
type ScheduledMessage struct {
	ID        int64
	ChatID    int64
	SenderID  int64
	Type      string
	Text      string
	Entities  []MessageEntity
	ReplyToID *int64
	MediaID   *int64
	SendAt    time.Time
	CreatedAt time.Time
}
