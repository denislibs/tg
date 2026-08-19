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
	// Последние 3 реагировавших (свежие первыми) на каждую реакцию — ССЫЛКИ на
	// пиров для аватаров в чипе (tweb count<4). Имя и фото клиент берёт из
	// своего кэша: снимок карточки прямо в jsonb был бы третьей формой того же
	// пользователя. Режем [1:3] после ORDER BY created_at DESC.
	rows, err := q.Query(ctx,
		`SELECT re.message_id, re.emoji, count(*), bool_or(re.user_id=$2),
		        (array_agg(re.user_id ORDER BY re.created_at DESC))[1:3]
		 FROM reactions re
		 WHERE re.message_id = ANY($1)
		 GROUP BY re.message_id, re.emoji ORDER BY count(*) DESC, re.emoji ASC`,
		messageIDs, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[int64][]domain.ReactionCount)
	for rows.Next() {
		var msgID int64
		var rc domain.ReactionCount
		var recent []int64
		if err := rows.Scan(&msgID, &rc.Emoji, &rc.Count, &rc.Mine, &recent); err != nil {
			return nil, err
		}
		for _, id := range recent {
			rc.Recent = append(rc.Recent, domain.NewPeerUser(id))
		}
		out[msgID] = append(out[msgID], rc)
	}
	return out, rows.Err()
}

// ReactionUsers lists who reacted to a message and with which emoji, oldest first,
// joined with users for display (name/username/avatar) — for the who-reacted popup.
func (r *ReactionsRepo) ReactionUsers(ctx context.Context, messageID int64) ([]domain.ReactionUser, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT `+userRealCols("u.")+`, re.emoji
		   FROM reactions re
		   JOIN users u ON u.id = re.user_id
		  WHERE re.message_id = $1
		  ORDER BY re.created_at`,
		messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.ReactionUser, 0)
	for rows.Next() {
		var ru domain.ReactionUser
		var u userRealScan
		if err := rows.Scan(append(u.dest(), &ru.Emoji)...); err != nil {
			return nil, err
		}
		ru.User = u.user(true)
		out = append(out, ru)
	}
	return out, rows.Err()
}
