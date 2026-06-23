package messaging

import "context"

// ReactionCount is an aggregated reaction tally for one emoji on a message.
type ReactionCount struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

type ReactionsRepo struct{}

func NewReactionsRepo() *ReactionsRepo { return &ReactionsRepo{} }

// Add records a user's reaction. Idempotent (no error if it already exists).
func (r *ReactionsRepo) Add(ctx context.Context, q Querier, messageID, userID int64, emoji string) error {
	_, err := q.Exec(ctx,
		`INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)
		 ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
		messageID, userID, emoji)
	return err
}

// Remove deletes a user's reaction. Idempotent.
func (r *ReactionsRepo) Remove(ctx context.Context, q Querier, messageID, userID int64, emoji string) error {
	_, err := q.Exec(ctx,
		`DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
		messageID, userID, emoji)
	return err
}

// ReactionsFor returns aggregated counts per emoji for a message, most popular first.
func (r *ReactionsRepo) ReactionsFor(ctx context.Context, q Querier, messageID int64) ([]ReactionCount, error) {
	rows, err := q.Query(ctx,
		`SELECT emoji, count(*) FROM reactions WHERE message_id=$1
		 GROUP BY emoji ORDER BY count(*) DESC, emoji ASC`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReactionCount
	for rows.Next() {
		var rc ReactionCount
		if err := rows.Scan(&rc.Emoji, &rc.Count); err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}
