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
	MemberIDs(ctx context.Context, chatID int64) ([]int64, error)
	IsMember(ctx context.Context, chatID, userID int64) (bool, error)
	ListDialogs(ctx context.Context, userID int64) ([]domain.Dialog, error)
	ChatPartners(ctx context.Context, userID int64) ([]int64, error)
	IncUnread(ctx context.Context, chatID, userID int64) error
	CurrentReadSeq(ctx context.Context, chatID, userID int64) (int64, error)
	SetRead(ctx context.Context, chatID, userID, seq int64, unread int) error
}

type MessageRepo interface {
	NextSeq(ctx context.Context, chatID int64) (int64, error)
	Insert(ctx context.Context, m domain.Message) (domain.Message, error)
	FindByClientMsgID(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error)
	GetHistory(ctx context.Context, chatID, offsetSeq int64, addOffset, limit int) ([]domain.Message, error)
	CountMessages(ctx context.Context, chatID int64) (int, error)
	CountUnread(ctx context.Context, chatID, userID, afterSeq int64) (int, error)
	MessageChatID(ctx context.Context, messageID int64) (int64, error)
}

type UpdateRepo interface {
	AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error)
	GetUserState(ctx context.Context, userID int64) (domain.UserState, error)
	UpdatesSince(ctx context.Context, userID, sincePts int64, limit int) ([]domain.Update, error)
}

type ReactionRepo interface {
	Add(ctx context.Context, messageID, userID int64, emoji string) error
	Remove(ctx context.Context, messageID, userID int64, emoji string) error
	ReactionsFor(ctx context.Context, messageID int64) ([]domain.ReactionCount, error)
}

type MediaAccessRepo interface {
	OwnerID(ctx context.Context, mediaID int64) (int64, error) // domain.ErrNotFound if absent
	CanAccess(ctx context.Context, userID, mediaID int64) (bool, error)
}

type EventPublisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

type PushNotifier interface {
	NotifyNewMessage(ctx context.Context, recipientID, chatID, msgID, seq, senderID int64, text string)
}

// --- DTOs ---

type SendInput struct {
	ChatID, SenderID int64
	Type, Text       string
	ReplyToID        *int64
	ClientMsgID      string
	MediaID          *int64
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
