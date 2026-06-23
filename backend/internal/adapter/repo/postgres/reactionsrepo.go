package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// ReactionsRepo is a postgres-backed adapter implementing the chat usecase's ReactionRepo port.
type ReactionsRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.ReactionRepo = (*ReactionsRepo)(nil)

func NewReactionsRepo(pool *pgxpool.Pool) *ReactionsRepo { return &ReactionsRepo{pool: pool} }

// Add records a user's reaction. Idempotent (no error if it already exists).
func (r *ReactionsRepo) Add(ctx context.Context, messageID, userID int64, emoji string) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)
		 ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
		messageID, userID, emoji)
	return err
}

// Remove deletes a user's reaction. Idempotent.
func (r *ReactionsRepo) Remove(ctx context.Context, messageID, userID int64, emoji string) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
		messageID, userID, emoji)
	return err
}

// ReactionsFor returns aggregated counts per emoji for a message, most popular first.
func (r *ReactionsRepo) ReactionsFor(ctx context.Context, messageID int64) ([]domain.ReactionCount, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT emoji, count(*) FROM reactions WHERE message_id=$1
		 GROUP BY emoji ORDER BY count(*) DESC, emoji ASC`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ReactionCount
	for rows.Next() {
		var rc domain.ReactionCount
		if err := rows.Scan(&rc.Emoji, &rc.Count); err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}
