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
	ChatID      int64
	Type        string
	Title       string
	Username    string
	LastReadSeq int64
	// PeerReadSeq is the OTHER side's read horizon (read_outbox): the peer's
	// last_read_seq for a private chat, the MIN across other members for a group
	// (read-by-all), 0 for channels. Used for outgoing sent/read ticks
	// (message seq <= PeerReadSeq ⇒ delivered+read ✓✓).
	PeerReadSeq  int64
	UnreadCount  int
	Muted        bool
	// Pinned — диалог закреплён вверху списка; Archived — убран в «Архив»
	// (пер-юзерные флаги членства, tweb pinned dialogs + folder_id=1).
	Pinned   bool
	Archived bool
	// IsForum — в группе включены темы (клиент рендерит список топиков).
	IsForum bool
	HasLast bool
	LastSeq      int64
	LastText     string
	LastSenderID int64
	LastAt       time.Time
	// LastMediaID/LastType describe the last message's media for the sidebar
	// preview thumbnail + type label (0/"" when it's a plain text message).
	LastMediaID int64
	LastType    string
	// LastForwarded is true when the last message was forwarded (shows a forward
	// arrow before the chat-list preview, like Telegram).
	LastForwarded bool
	// LastSenderName is the last message sender's short name (first name, else
	// display name) — for the "Имя: …" preview prefix in group chats.
	LastSenderName string
	// PhotoURL is the group/channel photo content path ("" when unset; private
	// chats carry the peer's avatar in Peer instead).
	PhotoURL string
	// Peer is the other member of a private chat (nil for non-private chats).
	Peer *DialogPeer
	// AutoDeletePeriod — период автоудаления сообщений чата в секундах (0 — выкл).
	AutoDeletePeriod int
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
	// Group-wide settings (edit screens): default member permissions, slowmode,
	// reaction policy, history visibility for new members.
	Settings ChatSettings
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
// BannedUser is one row of a chat's removed-users list.
type BannedUser struct {
	UserID   int64
	BannedBy int64
}

// SavedDialog is one grouped row of Saved Messages («Избранное» → таб «Чаты»):
// all saved messages attributed to one source peer (tweb saved dialogs).
// Kind 'self' («Мои заметки») groups the user's own non-forwarded notes.
type SavedDialog struct {
	Kind     string // 'self' | 'user' | 'chat'
	PeerID   int64  // user/chat id; 0 for 'self'
	Title    string // resolved peer title ('' for 'self' — client names it)
	PhotoURL string
	Count    int
	Last     Message
}

type UserCard struct {
	ID          int64
	Username    string
	DisplayName string
	FirstName   string
	AvatarURL   string
	Phone       string
}

// ShortName is the name Telegram uses in compact contexts (chat-list preview
// prefix, typing label): the first name when set, else the full display name.
func (u UserCard) ShortName() string {
	if u.FirstName != "" {
		return u.FirstName
	}
	return u.DisplayName
}

// ChannelUpdate is one entry in a channel's per-channel updates log
// (the catch-up feed read by GET /channels/{id}/difference).
type ChannelUpdate struct {
	Pts      int64
	PtsCount int
	Payload  []byte
}
