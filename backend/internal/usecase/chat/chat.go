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
	joinReqs    JoinRequestRepo
	channels    ChannelRepo
	search      SearchRepo
	publisher   EventPublisher
	chPub       ChannelPublisher
	notifier    PushNotifier
	privacy     PrivacyChecker
}

// New constructs the chat interactor from its ports.
func New(tx TxManager, chats ChatRepo, msgs MessageRepo, updates UpdateRepo, reactions ReactionRepo, mediaAccess MediaAccessRepo, groups GroupRepo, invites InviteRepo, channels ChannelRepo, search SearchRepo, joinReqs JoinRequestRepo) *Interactor {
	return &Interactor{
		tx:          tx,
		chats:       chats,
		msgs:        msgs,
		updates:     updates,
		reactions:   reactions,
		mediaAccess: mediaAccess,
		groups:      groups,
		invites:     invites,
		joinReqs:    joinReqs,
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

// SetPrivacy подключает проверки конфиденциальности (optional).
func (i *Interactor) SetPrivacy(p PrivacyChecker) { i.privacy = p }

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

// GetOrCreateSaved returns the user's "Saved Messages" self-chat, creating it on
// first access. Mirrors CreatePrivateChat's find-then-lock-then-create pattern.
func (i *Interactor) GetOrCreateSaved(ctx context.Context, userID int64) (int64, error) {
	if id, err := i.chats.FindSaved(ctx, userID); err == nil {
		return id, nil
	} else if !errors.Is(err, domain.ErrNotFound) {
		return 0, err
	}
	var chatID int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.chats.FindSaved(ctx, userID)
		if e == nil {
			chatID = id
			return nil
		}
		if !errors.Is(e, domain.ErrNotFound) {
			return e
		}
		id, e = i.chats.CreateSaved(ctx, userID)
		chatID = id
		return e
	})
	return chatID, err
}

// SavedDialogs is the grouped «Чаты»-tab of Saved Messages: saved messages
// clustered by forward origin. Empty when the saved chat doesn't exist yet.
func (i *Interactor) SavedDialogs(ctx context.Context, userID int64) ([]domain.SavedDialog, error) {
	chatID, err := i.chats.FindSaved(ctx, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return []domain.SavedDialog{}, nil
	}
	if err != nil {
		return nil, err
	}
	return i.msgs.SavedDialogs(ctx, chatID, userID)
}

// PostServiceMessage delivers a message from the official service account
// (domain.ServiceUserID) into its private chat with toUserID, creating that chat on
// first use. Reuses the normal Send pipeline (seq, updates, realtime, push).
func (i *Interactor) PostServiceMessage(ctx context.Context, toUserID int64, text string) error {
	if toUserID == domain.ServiceUserID {
		return nil
	}
	chatID, err := i.CreatePrivateChat(ctx, toUserID, domain.ServiceUserID)
	if err != nil {
		return err
	}
	_, err = i.Send(ctx, SendInput{ChatID: chatID, SenderID: domain.ServiceUserID, Text: text})
	return err
}

// NotifyNewLogin posts a security notification to the user's service chat (satisfies
// auth.ServiceNotifier). Called best-effort after a new device signs in.
// ListDialogs returns the user's chat list. Аватар пира скрывается, когда его
// privacy-правило profile_photo не разрешает показ этому пользователю.
func (i *Interactor) ListDialogs(ctx context.Context, userID int64) ([]domain.Dialog, error) {
	dialogs, err := i.chats.ListDialogs(ctx, userID)
	if err != nil || i.privacy == nil {
		return dialogs, err
	}
	peerIDs := make([]int64, 0, len(dialogs))
	for _, d := range dialogs {
		if d.Peer != nil {
			peerIDs = append(peerIDs, d.Peer.ID)
		}
	}
	if len(peerIDs) == 0 {
		return dialogs, nil
	}
	vis, err := i.privacy.VisibleMap(ctx, userID, peerIDs, domain.PrivacyProfilePhoto)
	if err != nil {
		return nil, err
	}
	for _, d := range dialogs {
		if d.Peer != nil && !vis[d.Peer.ID] {
			d.Peer.AvatarURL = ""
		}
	}
	return dialogs, nil
}

// ChatPartners returns the user ids that share a chat with userID.
func (i *Interactor) ChatPartners(ctx context.Context, userID int64) ([]int64, error) {
	return i.chats.ChatPartners(ctx, userID)
}
