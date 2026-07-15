// Package chat is the chat/message/sync/reactions application logic.
package chat

import (
	"context"
	"encoding/json"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// TxManager runs fn inside a transaction; the tx is carried in the returned ctx
// (repo adapters pick it up). Keeps pgx out of the usecase.
type TxManager interface {
	WithinTx(ctx context.Context, fn func(ctx context.Context) error) error
}

type ChatRepo interface {
	FindPrivate(ctx context.Context, a, b int64) (int64, error) // domain.ErrNotFound if none
	CreatePrivate(ctx context.Context, a, b int64) (int64, error)
	FindSaved(ctx context.Context, userID int64) (int64, error) // domain.ErrNotFound if none
	CreateSaved(ctx context.Context, userID int64) (int64, error)
	MemberIDs(ctx context.Context, chatID int64) ([]int64, error)
	IsMember(ctx context.Context, chatID, userID int64) (bool, error)
	ChatType(ctx context.Context, chatID int64) (string, error) // 'private'|'group'|'channel'|'saved'
	ListDialogs(ctx context.Context, userID int64) ([]domain.Dialog, error)
	ChatPartners(ctx context.Context, userID int64) ([]int64, error)
	IncUnread(ctx context.Context, chatID, userID int64) error
	CurrentReadSeq(ctx context.Context, chatID, userID int64) (int64, error)
	SetRead(ctx context.Context, chatID, userID, seq int64, unread int) error
	PinMessage(ctx context.Context, chatID, msgID, byUser int64) error
	UnpinMessage(ctx context.Context, chatID, msgID int64) error
	ListPins(ctx context.Context, chatID int64) ([]domain.Message, error)
	Viewers(ctx context.Context, chatID, seq, excludeUser int64) ([]int64, error)
}

type GroupRepo interface {
	CreateMultiMember(ctx context.Context, typ, title, about, username string, isPublic bool, creatorID int64) (int64, error)
	AddMember(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error
	RemoveMember(ctx context.Context, chatID, userID int64) error
	GetMember(ctx context.Context, chatID, userID int64) (domain.Member, error) // domain.ErrNotFound if not a member
	SetRole(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error
	SetMuted(ctx context.Context, chatID, userID int64, muted bool) error
	Card(ctx context.Context, chatID, viewerID int64) (domain.ChatCard, error) // domain.ErrNotFound if no chat
	EditInfo(ctx context.Context, chatID int64, title, about, username string) error
	SetPhoto(ctx context.Context, chatID, mediaID int64) error
	UsersByIDs(ctx context.Context, ids []int64) ([]domain.UserCard, error)
	ListMembers(ctx context.Context, chatID int64, offset, limit int) ([]domain.Member, error)
	SetDiscussion(ctx context.Context, channelID, groupID int64) error
	GetDiscussion(ctx context.Context, channelID int64) (int64, error) // 0 = none
	// Group edit-screen settings + removed-users list.
	Settings(ctx context.Context, chatID int64) (domain.ChatSettings, error)
	SetType(ctx context.Context, chatID int64, isPublic bool, username string) error // domain.ErrConflict on taken username
	SetPermissions(ctx context.Context, chatID int64, perms domain.MemberPerms, slowmodeSeconds int) error
	SetReactions(ctx context.Context, chatID int64, mode string, allowed []string) error
	SetHistoryForNew(ctx context.Context, chatID int64, visible bool) error
	Ban(ctx context.Context, chatID, userID, bannedBy int64) error
	Unban(ctx context.Context, chatID, userID int64) error
	IsBanned(ctx context.Context, chatID, userID int64) (bool, error)
	ListBans(ctx context.Context, chatID int64) ([]domain.BannedUser, error)
	DeleteChat(ctx context.Context, chatID int64) error // каскадом members/messages
}

type InviteRepo interface {
	Create(ctx context.Context, chatID, createdBy int64, token string, usageLimit *int, requiresApproval bool) (domain.InviteLink, error)
	GetByToken(ctx context.Context, token string) (domain.InviteLink, error) // domain.ErrNotFound
	List(ctx context.Context, chatID int64) ([]domain.InviteLink, error)
	IncUses(ctx context.Context, id int64) error
	Revoke(ctx context.Context, chatID int64, token string) error
}

type JoinRequestRepo interface {
	Create(ctx context.Context, chatID, userID int64, inviteToken string) error // idempotent (ON CONFLICT DO NOTHING)
	List(ctx context.Context, chatID int64) ([]domain.JoinRequest, error)
	Delete(ctx context.Context, chatID, userID int64) error
}

type MessageRepo interface {
	NextSeq(ctx context.Context, chatID int64) (int64, error)
	Insert(ctx context.Context, m domain.Message) (domain.Message, error)
	FindByClientMsgID(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error)
	GetByID(ctx context.Context, msgID int64) (domain.Message, error)
	GetByIDs(ctx context.Context, ids []int64) ([]domain.Message, error)
	SearchMessages(ctx context.Context, chatID int64, q string, offset, limit int) ([]domain.Message, int, error)
	MediaHistory(ctx context.Context, chatID int64, filter string, offset, limit int) ([]domain.Message, int, error)
	GetAround(ctx context.Context, chatID, userID, centerSeq int64, limit int) ([]domain.Message, bool, bool, error)
	GetHistory(ctx context.Context, chatID, userID, offsetSeq int64, addOffset, limit int) ([]domain.Message, error)
	// LastMessageAt is the newest non-deleted message time by senderID in the chat
	// (slowmode); domain.ErrNotFound when they haven't posted yet.
	LastMessageAt(ctx context.Context, chatID, senderID int64) (time.Time, error)
	// SavedDialogs groups the saved-messages chat by forward origin
	// («Избранное» → таб «Чаты»), newest group first.
	SavedDialogs(ctx context.Context, chatID, userID int64) ([]domain.SavedDialog, error)
	UpdateText(ctx context.Context, msgID int64, text string, entities []domain.MessageEntity) (domain.Message, error)
	SoftDelete(ctx context.Context, msgID int64) error
	HideForUser(ctx context.Context, userID, msgID int64) error
	ListThread(ctx context.Context, chatID, threadRootID int64, offset, limit int) ([]domain.Message, error)
	CountThread(ctx context.Context, chatID, threadRootID int64) (int, error)
	CountMessages(ctx context.Context, chatID int64) (int, error)
	CountUnread(ctx context.Context, chatID, userID, afterSeq int64) (int, error)
	MessageChatID(ctx context.Context, messageID int64) (int64, error)
	// RegisterChannelViews records userID's view of every channel post in chatID
	// up to upToSeq (deduped per viewer); a no-op for non-channel chats.
	RegisterChannelViews(ctx context.Context, chatID, userID, upToSeq int64) error
	// ViewCounts returns current view counts for the given message ids.
	ViewCounts(ctx context.Context, ids []int64) (map[int64]int64, error)
	// ClearMediaUnread drops a message's media_unread flag; reports whether the
	// row actually changed.
	ClearMediaUnread(ctx context.Context, msgID int64) (bool, error)
}

type UpdateRepo interface {
	AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error)
	GetUserState(ctx context.Context, userID int64) (domain.UserState, error)
	UpdatesSince(ctx context.Context, userID, sincePts int64, limit int) ([]domain.Update, error)
}

type ChannelRepo interface {
	// AppendUpdate bumps the channel's pts by 1 and records the update; returns the new pts.
	AppendUpdate(ctx context.Context, channelID int64, payload json.RawMessage) (int64, error)
	UpdatesSince(ctx context.Context, channelID, sincePts int64, limit int) ([]domain.ChannelUpdate, error)
	CurrentPts(ctx context.Context, channelID int64) (int64, error)
}

type SearchRepo interface {
	SearchChats(ctx context.Context, q string, limit int) ([]domain.ChatCard, error) // public only
	SearchUsers(ctx context.Context, q string, limit int) ([]domain.UserCard, error)
	PublicChatByUsername(ctx context.Context, username string) (int64, error) // domain.ErrNotFound
}

type ReactionRepo interface {
	Add(ctx context.Context, messageID, userID int64, emoji string) error
	Remove(ctx context.Context, messageID, userID int64, emoji string) error
	ReactionsFor(ctx context.Context, messageID int64) ([]domain.ReactionCount, error)
}

type MediaAccessRepo interface {
	OwnerID(ctx context.Context, mediaID int64) (int64, error) // domain.ErrNotFound if absent
	CanAccess(ctx context.Context, userID, mediaID int64) (bool, error)
	// DimsByIDs batch-loads width/height/mime for media ids (history read model,
	// so the client can reserve the media box before the bytes load). Missing ids
	// are simply absent from the map.
	DimsByIDs(ctx context.Context, ids []int64) (map[int64]MediaDims, error)
}

// MediaDims is the media metadata the message read model attaches so the client
// can render a media bubble fully from the message — no per-media meta request.
type MediaDims struct {
	Width    int
	Height   int
	Mime     string
	Blur     []byte // blur preview bytes (JSON-encoded as base64, LQIP placeholder)
	HasThumb bool
	Duration int
	Size     int64
	FileName string
}

type EventPublisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

type ChannelPublisher interface {
	PublishToChannel(ctx context.Context, channelID int64, frame []byte) error
}

type PushNotifier interface {
	NotifyNewMessage(ctx context.Context, recipientID, chatID, msgID, seq, senderID int64, text string)
}

// --- DTOs ---

type SendInput struct {
	ChatID, SenderID int64
	Type, Text       string
	Entities         []domain.MessageEntity
	ReplyToID        *int64
	ClientMsgID      string
	MediaID          *int64
	ThreadRootID     *int64
}

type HistoryResult struct {
	Messages []domain.Message
	Count    int
}

type Difference struct {
	NewMessages  []json.RawMessage `json:"new_messages"`
	OtherUpdates []json.RawMessage `json:"other_updates"`
	State        domain.UserState  `json:"state"`
	Slice        bool              `json:"slice"`
	TooLong      bool              `json:"too_long"`
}

const (
	syncLimit        = 500
	tooLongThreshold = 2000
	maxEmojiLen      = 32
	presenceTTL      = 35 * time.Second // (kept here only if needed; presence stays in its package)
)
