package messaging

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns transactions and business rules over the repositories.
type Service struct {
	pool    *pgxpool.Pool
	chats   *ChatsRepo
	msgs    *MessagesRepo
	updates *UpdatesRepo
}

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

// CreatePrivateChat returns the existing private chat between the two users, or creates one.
func (s *Service) CreatePrivateChat(ctx context.Context, me, other int64) (int64, error) {
	id, err := s.chats.FindPrivateChat(ctx, s.pool, me, other)
	if err == nil {
		return id, nil
	}
	if err != ErrNotFound {
		return 0, err
	}
	return s.chats.CreatePrivateChat(ctx, s.pool, me, other)
}

// ListDialogs returns the user's chat list.
func (s *Service) ListDialogs(ctx context.Context, userID int64) ([]Dialog, error) {
	return s.chats.ListDialogs(ctx, s.pool, userID)
}
