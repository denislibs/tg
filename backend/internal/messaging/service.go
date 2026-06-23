package messaging

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns transactions and business rules over the repositories.
type Service struct {
	pool      *pgxpool.Pool
	chats     *ChatsRepo
	msgs      *MessagesRepo
	updates   *UpdatesRepo
	publisher Publisher
	notifier  Notifier
}

// SetPublisher attaches a realtime publisher (optional). When nil, the service
// records updates in the DB but pushes nothing live.
func (s *Service) SetPublisher(p Publisher) { s.publisher = p }

// SetNotifier attaches a push notifier (optional).
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{
		pool:    pool,
		chats:   NewChatsRepo(),
		msgs:    NewMessagesRepo(),
		updates: NewUpdatesRepo(),
	}
}

// nowMillis is the server clock used for update dates.
func nowMillis() int64 { return time.Now().UnixMilli() }

// CreatePrivateChat returns the existing private chat between the two users, or
// creates one. A transaction-scoped advisory lock keyed on the (sorted) user pair
// serializes concurrent first-time creation so two requests can't race into
// duplicate private chats.
func (s *Service) CreatePrivateChat(ctx context.Context, me, other int64) (int64, error) {
	if id, err := s.chats.FindPrivateChat(ctx, s.pool, me, other); err == nil {
		return id, nil
	} else if err != ErrNotFound {
		return 0, err
	}

	a, b := me, other
	if a > b {
		a, b = b, a
	}
	lockKey := fmt.Sprintf("private:%d:%d", a, b)

	var chatID int64
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); e != nil {
			return e
		}
		// Re-check under the lock: another request may have just created it.
		id, e := s.chats.FindPrivateChat(ctx, tx, me, other)
		if e == nil {
			chatID = id
			return nil
		}
		if e != ErrNotFound {
			return e
		}
		id, e = s.chats.CreatePrivateChat(ctx, tx, me, other)
		chatID = id
		return e
	})
	return chatID, err
}

// ListDialogs returns the user's chat list.
func (s *Service) ListDialogs(ctx context.Context, userID int64) ([]Dialog, error) {
	return s.chats.ListDialogs(ctx, s.pool, userID)
}

// ChatPartners returns the user ids that share a chat with userID.
func (s *Service) ChatPartners(ctx context.Context, userID int64) ([]int64, error) {
	return s.chats.ChatPartners(ctx, s.pool, userID)
}

// CanAccessMedia reports whether userID may download a media object: either they
// own it, or they are a member of a chat that has a message referencing it.
func (s *Service) CanAccessMedia(ctx context.Context, userID, mediaID int64) (bool, error) {
	var allowed bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM media WHERE id=$1 AND owner_id=$2
		   UNION ALL
		   SELECT 1 FROM messages m
		     JOIN chat_members cm ON cm.chat_id = m.chat_id
		     WHERE m.media_id=$1 AND cm.user_id=$2
		 )`, mediaID, userID).Scan(&allowed)
	return allowed, err
}
