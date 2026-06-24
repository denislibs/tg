package domain

import "time"

type Message struct {
	ID          int64
	ChatID      int64
	Seq         int64
	SenderID    int64
	Type        string
	Text        string
	ReplyToID   *int64
	MediaID     *int64
	ClientMsgID  *string
	ThreadRootID *int64
	CreatedAt    time.Time
	Deleted      bool
}
