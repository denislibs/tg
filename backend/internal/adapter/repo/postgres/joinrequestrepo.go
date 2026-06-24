package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// JoinRequestRepo is a postgres-backed adapter implementing the chat usecase's
// JoinRequestRepo port: pending join requests for approval-required invite
// links. Like the other repos it runs every query through querier(ctx, pool)
// so methods compose inside a TxManager transaction.
type JoinRequestRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.JoinRequestRepo = (*JoinRequestRepo)(nil)

func NewJoinRequestRepo(pool *pgxpool.Pool) *JoinRequestRepo { return &JoinRequestRepo{pool: pool} }

// Create records a pending join request. It is idempotent: a repeat request for
// the same (chat, user) is dropped via the UNIQUE (chat_id, user_id) constraint.
func (r *JoinRequestRepo) Create(ctx context.Context, chatID, userID int64, inviteToken string) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO join_requests (chat_id, user_id, invite_token)
		 VALUES ($1,$2,$3) ON CONFLICT (chat_id, user_id) DO NOTHING`,
		chatID, userID, inviteToken)
	return err
}

func (r *JoinRequestRepo) List(ctx context.Context, chatID int64) ([]domain.JoinRequest, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT chat_id, user_id, created_at
		   FROM join_requests WHERE chat_id=$1 ORDER BY created_at`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.JoinRequest
	for rows.Next() {
		var jr domain.JoinRequest
		if err := rows.Scan(&jr.ChatID, &jr.UserID, &jr.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, jr)
	}
	return out, rows.Err()
}

func (r *JoinRequestRepo) Delete(ctx context.Context, chatID, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM join_requests WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	return err
}
