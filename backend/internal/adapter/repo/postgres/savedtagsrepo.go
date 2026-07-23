package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// SavedTagsRepo is a postgres-backed adapter implementing the chat usecase's
// SavedTagRepo port. Tag titles live in saved_reaction_tags; the tag list and
// per-tag counts are derived from reactions on the user's saved chat.
type SavedTagsRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.SavedTagRepo = (*SavedTagsRepo)(nil)

func NewSavedTagsRepo(pool *pgxpool.Pool) *SavedTagsRepo { return &SavedTagsRepo{pool: pool} }

// ListWithCounts returns every reaction the user placed on a non-deleted message
// in their saved chat, joined with its stored title (empty if none) and the count
// of tagged messages, most used first.
func (r *SavedTagsRepo) ListWithCounts(ctx context.Context, userID, savedChatID int64) ([]domain.SavedTag, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT re.emoji, COALESCE(t.title,''), count(*)
		   FROM reactions re
		   JOIN messages m ON m.id = re.message_id AND m.deleted_at IS NULL
		   LEFT JOIN saved_reaction_tags t ON t.user_id = re.user_id AND t.reaction = re.emoji
		  WHERE re.user_id = $1 AND m.chat_id = $2
		  GROUP BY re.emoji, t.title
		  ORDER BY count(*) DESC, re.emoji ASC`,
		userID, savedChatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.SavedTag, 0)
	for rows.Next() {
		var tag domain.SavedTag
		if err := rows.Scan(&tag.Reaction, &tag.Title, &tag.Count); err != nil {
			return nil, err
		}
		out = append(out, tag)
	}
	return out, rows.Err()
}

// SetTitle upserts a tag's display name; an empty title clears it (row removed).
func (r *SavedTagsRepo) SetTitle(ctx context.Context, userID int64, reaction, title string) error {
	q := querier(ctx, r.pool)
	if title == "" {
		_, err := q.Exec(ctx,
			`DELETE FROM saved_reaction_tags WHERE user_id=$1 AND reaction=$2`,
			userID, reaction)
		return err
	}
	_, err := q.Exec(ctx,
		`INSERT INTO saved_reaction_tags (user_id, reaction, title) VALUES ($1,$2,$3)
		 ON CONFLICT (user_id, reaction) DO UPDATE SET title=EXCLUDED.title`,
		userID, reaction, title)
	return err
}
