package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// StarReactionsRepo — платные ⭐-реакции (star_reactions): накопительный вклад
// пользователя в звёздах и агрегат сообщения. Реализует
// usecasechat.StarReactionRepo.
type StarReactionsRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.StarReactionRepo = (*StarReactionsRepo)(nil)

func NewStarReactionsRepo(pool *pgxpool.Pool) *StarReactionsRepo {
	return &StarReactionsRepo{pool: pool}
}

// Add накопительно добавляет delta звёзд пользователя к сообщению (upsert),
// обновляя флаг анонимности и updated_at; возвращает новый суммарный вклад.
func (r *StarReactionsRepo) Add(ctx context.Context, messageID, userID, delta int64, anonymous bool) (int64, error) {
	var stars int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO star_reactions (message_id, user_id, stars, anonymous)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (message_id, user_id) DO UPDATE
		   SET stars = star_reactions.stars + EXCLUDED.stars,
		       anonymous = EXCLUDED.anonymous,
		       updated_at = now()
		 RETURNING stars`,
		messageID, userID, delta, anonymous).Scan(&stars)
	return stars, err
}

// AggregatesFor батч-загружает агрегат звёзд по сообщениям (Total) и личный
// вклад зрителя (Mine). Сообщения без платных реакций отсутствуют в мапе.
func (r *StarReactionsRepo) AggregatesFor(ctx context.Context, messageIDs []int64, viewerID int64) (map[int64]domain.StarReactionAgg, error) {
	out := map[int64]domain.StarReactionAgg{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT message_id,
		        sum(stars),
		        coalesce(sum(stars) FILTER (WHERE user_id = $2), 0)
		   FROM star_reactions WHERE message_id = ANY($1)
		  GROUP BY message_id`,
		messageIDs, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var agg domain.StarReactionAgg
		if e := rows.Scan(&id, &agg.Total, &agg.Mine); e != nil {
			return nil, e
		}
		out[id] = agg
	}
	return out, rows.Err()
}

// TopSenders — крупнейшие отправители звёзд сообщения (по убыванию вклада),
// joined с users для отображения. Anonymous сохраняется во флаге (личность
// прячет read-модель usecase).
func (r *StarReactionsRepo) TopSenders(ctx context.Context, messageID int64, limit int) ([]domain.StarReactionSender, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT u.id, COALESCE(u.username,''), u.display_name, COALESCE(u.avatar_url,''),
		        sr.stars, sr.anonymous
		   FROM star_reactions sr
		   JOIN users u ON u.id = sr.user_id
		  WHERE sr.message_id = $1
		  ORDER BY sr.stars DESC, sr.updated_at ASC
		  LIMIT $2`,
		messageID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.StarReactionSender, 0)
	for rows.Next() {
		var s domain.StarReactionSender
		if e := rows.Scan(&s.User.ID, &s.User.Username, &s.User.DisplayName, &s.User.AvatarURL, &s.Stars, &s.Anonymous); e != nil {
			return nil, e
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
