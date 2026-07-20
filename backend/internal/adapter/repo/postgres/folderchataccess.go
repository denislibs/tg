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
// чатов (chats/chat_members): переиспользует GroupRepo.Card/AddMember, а тип и
// членство читает напрямую через querier — так вступление по ссылке-приглашению
// в папку ничем не отличается от обычного вступления в чат.
type FolderChatAccess struct {
	pool   *pgxpool.Pool
	groups *GroupRepo
}

var _ usecasefolders.Chats = (*FolderChatAccess)(nil)

func NewFolderChatAccess(pool *pgxpool.Pool) *FolderChatAccess {
	return &FolderChatAccess{pool: pool, groups: NewGroupRepo(pool)}
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

// Join добавляет userID участником: канал — подписчик (read-only), группа —
// обычный участник. Роль переиспользует ту же семантику, что и join-public.
func (a *FolderChatAccess) Join(ctx context.Context, chatID, userID int64) error {
	typ, _, err := a.Info(ctx, chatID)
	if err != nil {
		return err
	}
	role := domain.RoleMember
	if typ == "channel" {
		role = domain.RoleSubscriber
	}
	return a.groups.AddMember(ctx, chatID, userID, role, 0)
}
