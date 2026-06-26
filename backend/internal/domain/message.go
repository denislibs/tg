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
	EditedAt     *time.Time
	// Forward attribution (set when the message was forwarded from elsewhere).
	FwdFromUserID *int64
	FwdFromChatID *int64
	FwdFromMsgID  *int64
	FwdDate       *time.Time
}
