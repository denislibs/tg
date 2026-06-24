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

// DialogPeer is the other participant of a private chat, used to render a
// chat's name and avatar in the chat list. It is nil for non-private chats.
type DialogPeer struct {
	ID          int64
	DisplayName string
	AvatarURL   string
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
	// Peer is the other member of a private chat (nil for non-private chats).
	Peer *DialogPeer
}
