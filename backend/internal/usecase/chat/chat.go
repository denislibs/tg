package chat

import (
	"context"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Interactor is the chat/message/sync/reactions application logic. It depends
// only on ports; transactions are run through the TxManager port.
type Interactor struct {
	tx          TxManager
	chats       ChatRepo
	msgs        MessageRepo
	updates     UpdateRepo
	reactions   ReactionRepo
	mediaAccess MediaAccessRepo
	groups      GroupRepo
	invites     InviteRepo
	channels    ChannelRepo
	search      SearchRepo
	publisher   EventPublisher
	chPub       ChannelPublisher
	notifier    PushNotifier
}

// New constructs the chat interactor from its ports.
func New(tx TxManager, chats ChatRepo, msgs MessageRepo, updates UpdateRepo, reactions ReactionRepo, mediaAccess MediaAccessRepo, groups GroupRepo, invites InviteRepo, channels ChannelRepo, search SearchRepo) *Interactor {
	return &Interactor{
		tx:          tx,
		chats:       chats,
		msgs:        msgs,
		updates:     updates,
		reactions:   reactions,
		mediaAccess: mediaAccess,
		groups:      groups,
		invites:     invites,
		channels:    channels,
		search:      search,
	}
}

// SetPublisher attaches a realtime publisher (optional). When nil, the
// interactor records updates in the DB but pushes nothing live.
func (i *Interactor) SetPublisher(p EventPublisher) { i.publisher = p }

// SetChannelPublisher attaches a channel-topic publisher (optional). When nil,
// channel posts are recorded in the channel_updates log but pushed nowhere live;
// clients catch up via GET /channels/{id}/difference.
func (i *Interactor) SetChannelPublisher(p ChannelPublisher) { i.chPub = p }

// SetNotifier attaches a push notifier (optional).
func (i *Interactor) SetNotifier(n PushNotifier) { i.notifier = n }

// nowMillis is the server clock used for update dates.
func nowMillis() int64 { return time.Now().UnixMilli() }

// CreatePrivateChat returns the existing private chat between the two users, or
// creates one. A transaction-scoped advisory lock keyed on the (sorted) user pair
// serializes concurrent first-time creation so two requests can't race into
// duplicate private chats.
func (i *Interactor) CreatePrivateChat(ctx context.Context, me, other int64) (int64, error) {
	if id, err := i.chats.FindPrivate(ctx, me, other); err == nil {
		return id, nil
	} else if !errors.Is(err, domain.ErrNotFound) {
		return 0, err
	}

	var chatID int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		// Re-check under the lock: another request may have just created it.
		// CreatePrivate is responsible for taking the advisory lock inside the tx.
		id, e := i.chats.FindPrivate(ctx, me, other)
		if e == nil {
			chatID = id
			return nil
		}
		if !errors.Is(e, domain.ErrNotFound) {
			return e
		}
		id, e = i.chats.CreatePrivate(ctx, me, other)
		chatID = id
		return e
	})
	return chatID, err
}

// ListDialogs returns the user's chat list.
func (i *Interactor) ListDialogs(ctx context.Context, userID int64) ([]domain.Dialog, error) {
	return i.chats.ListDialogs(ctx, userID)
}

// ChatPartners returns the user ids that share a chat with userID.
func (i *Interactor) ChatPartners(ctx context.Context, userID int64) ([]int64, error) {
	return i.chats.ChatPartners(ctx, userID)
}
