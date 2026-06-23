package domain

import "time"

type Chat struct {
	ID      int64
	Type    string // private | group | channel | saved
	LastSeq int64
}

type ChatMember struct {
	ChatID, UserID int64
	Role           string
	LastReadSeq    int64
	UnreadCount    int
	Muted          bool
}

// Dialog is a chat-list read model: a chat + the viewer's read state + last message.
type Dialog struct {
	ChatID       int64
	Type         string
	LastReadSeq  int64
	UnreadCount  int
	Muted        bool
	HasLast      bool
	LastSeq      int64
	LastText     string
	LastSenderID int64
	LastAt       time.Time
}
