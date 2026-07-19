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

// ReactionsFor batch-loads aggregated counts per emoji for messages, most popular
// first; Mine marks emojis the viewer reacted with. One query for the whole window.
func (r *ReactionsRepo) ReactionsFor(ctx context.Context, messageIDs []int64, viewerID int64) (map[int64][]domain.ReactionCount, error) {
	if len(messageIDs) == 0 {
		return map[int64][]domain.ReactionCount{}, nil
	}
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT message_id, emoji, count(*), bool_or(user_id=$2)
		 FROM reactions WHERE message_id = ANY($1)
		 GROUP BY message_id, emoji ORDER BY count(*) DESC, emoji ASC`,
		messageIDs, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[int64][]domain.ReactionCount)
	for rows.Next() {
		var msgID int64
		var rc domain.ReactionCount
		if err := rows.Scan(&msgID, &rc.Emoji, &rc.Count, &rc.Mine); err != nil {
			return nil, err
		}
		out[msgID] = append(out[msgID], rc)
	}
	return out, rows.Err()
}
