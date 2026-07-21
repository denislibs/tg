package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// InviteRepo is a postgres-backed adapter implementing the chat usecase's
// InviteRepo port: invite link creation, token resolution (excluding revoked
// links), per-chat listing, usage counting, and revocation. Like GroupRepo it
// runs every query through querier(ctx, pool) so methods compose inside a
// TxManager transaction.
type InviteRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.InviteRepo = (*InviteRepo)(nil)

func NewInviteRepo(pool *pgxpool.Pool) *InviteRepo { return &InviteRepo{pool: pool} }

func scanLink(row pgx.Row) (domain.InviteLink, error) {
	var l domain.InviteLink
	err := row.Scan(&l.ID, &l.ChatID, &l.Token, &l.CreatedBy, &l.UsageLimit, &l.Uses, &l.Revoked, &l.RequiresApproval, &l.ExpiresAt)
	return l, err
}

func (r *InviteRepo) Create(ctx context.Context, chatID, createdBy int64, token string, usageLimit *int, requiresApproval bool, expiresAt *time.Time) (domain.InviteLink, error) {
	l, err := scanLink(querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO invite_links (chat_id, created_by, token, usage_limit, requires_approval, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, chat_id, token, created_by, usage_limit, uses, revoked, requires_approval, expires_at`,
		chatID, createdBy, token, usageLimit, requiresApproval, expiresAt))
	return l, err
}

func (r *InviteRepo) GetByToken(ctx context.Context, token string) (domain.InviteLink, error) {
	l, err := scanLink(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, chat_id, token, created_by, usage_limit, uses, revoked, requires_approval, expires_at
		   FROM invite_links WHERE token=$1 AND revoked=false`, token))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.InviteLink{}, domain.ErrNotFound
	}
	return l, err
}

func (r *InviteRepo) List(ctx context.Context, chatID int64) ([]domain.InviteLink, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, chat_id, token, created_by, usage_limit, uses, revoked, requires_approval, expires_at
		   FROM invite_links WHERE chat_id=$1 AND revoked=false ORDER BY id DESC`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.InviteLink
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (r *InviteRepo) IncUses(ctx context.Context, id int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE invite_links SET uses = uses + 1 WHERE id=$1`, id)
	return err
}

func (r *InviteRepo) Revoke(ctx context.Context, chatID int64, token string) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE invite_links SET revoked=true WHERE chat_id=$1 AND token=$2`, chatID, token)
	return err
}
