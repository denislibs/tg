package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasefolders "github.com/messenger-denis/backend/internal/usecase/folders"
)

// FolderChatAccess реализует folders.Chats поверх тех же таблиц, что и логика
// чатов (chats/chat_members): карточку берёт у GroupRepo.Card, тип и членство
// читает напрямую через querier, а вступает ОБЩЕЙ точкой вступления usecase
// чатов (join) — так вступление по ссылке на папку ничем не отличается от
// обычного: та же роль по типу чата и тот же бан.
type FolderChatAccess struct {
	pool   *pgxpool.Pool
	groups *GroupRepo
	join   func(ctx context.Context, chatID, userID int64) error
}

var _ usecasefolders.Chats = (*FolderChatAccess)(nil)

// NewFolderChatAccess — join: точка вступления usecase чатов
// (chat.Interactor.JoinFolderChat).
func NewFolderChatAccess(pool *pgxpool.Pool, join func(ctx context.Context, chatID, userID int64) error) *FolderChatAccess {
	return &FolderChatAccess{pool: pool, groups: NewGroupRepo(pool), join: join}
}

func (a *FolderChatAccess) Info(ctx context.Context, chatID int64) (string, bool, error) {
	var typ string
	var isPublic bool
	err := querier(ctx, a.pool).QueryRow(ctx,
		`SELECT type, is_public FROM chats WHERE id=$1`, chatID).Scan(&typ, &isPublic)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, domain.ErrNotFound
	}
	return typ, isPublic, err
}

func (a *FolderChatAccess) Preview(ctx context.Context, chatID int64) (domain.FolderInviteChat, error) {
	// viewerID=0 — превью без учёта членства зрителя.
	c, err := a.groups.Card(ctx, chatID, 0)
	if err != nil {
		return domain.FolderInviteChat{}, err
	}
	return domain.FolderInviteChat{
		ID: c.ID, Title: c.Title, Type: c.Type, MemberCount: c.MemberCount,
	}, nil
}

func (a *FolderChatAccess) IsMember(ctx context.Context, chatID, userID int64) (bool, error) {
	var one int
	err := querier(ctx, a.pool).QueryRow(ctx,
		`SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// Join вступает в чат общей точкой вступления usecase чатов.
func (a *FolderChatAccess) Join(ctx context.Context, chatID, userID int64) error {
	return a.join(ctx, chatID, userID)
}
