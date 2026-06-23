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
}

// SetPublisher attaches a realtime publisher (optional). When nil, the service
// records updates in the DB but pushes nothing live.
func (s *Service) SetPublisher(p Publisher) { s.publisher = p }

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
