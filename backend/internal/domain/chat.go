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
	Verified    bool // official/service account (blue check)
}

// Dialog is a chat-list read model: a chat + the viewer's read state + last message.
type Dialog struct {
	ChatID       int64
	Type         string
	Title        string
	Username     string
	LastReadSeq  int64
	// PeerReadSeq is the OTHER side's read horizon (read_outbox): the peer's
	// last_read_seq for a private chat, the MIN across other members for a group
	// (read-by-all), 0 for channels. Used for outgoing sent/read ticks
	// (message seq <= PeerReadSeq ⇒ delivered+read ✓✓).
	PeerReadSeq  int64
	UnreadCount  int
	Muted        bool
	HasLast      bool
	LastSeq      int64
	LastText     string
	LastSenderID int64
	LastAt       time.Time
	// LastMediaID/LastType describe the last message's media for the sidebar
	// preview thumbnail + type label (0/"" when it's a plain text message).
	LastMediaID  int64
	LastType     string
	// LastForwarded is true when the last message was forwarded (shows a forward
	// arrow before the chat-list preview, like Telegram).
	LastForwarded bool
	// Peer is the other member of a private chat (nil for non-private chats).
	Peer *DialogPeer
}

// Member is a full membership row (role + admin rights + mute).
type Member struct {
	ChatID, UserID int64
	Role           string
	Rights         Rights
	Muted          bool
}

// ChatCard is the read model for a group/channel info screen.
type ChatCard struct {
	ID               int64
	Type             string
	Title            string
	Username         string
	About            string
	PhotoMediaID     *int64
	CreatorID        int64
	MemberCount      int
	IsPublic         bool
	MyRole           string
	MyRights         Rights
	Muted            bool
	DiscussionChatID int64
}

// InviteLink is a join token for a chat.
type InviteLink struct {
	ID               int64
	ChatID           int64
	Token            string
	CreatedBy        int64
	UsageLimit       *int
	Uses             int
	Revoked          bool
	RequiresApproval bool
}

// JoinRequest is a pending request to join a chat via an approval-required link.
type JoinRequest struct {
	ChatID    int64
	UserID    int64
	CreatedAt time.Time
}

// UserCard is a minimal public user record (batch lookups, sender names).
type UserCard struct {
	ID          int64
	Username    string
	DisplayName string
	AvatarURL   string
}

// ChannelUpdate is one entry in a channel's per-channel updates log
// (the catch-up feed read by GET /channels/{id}/difference).
type ChannelUpdate struct {
	Pts      int64
	PtsCount int
	Payload  []byte
}
