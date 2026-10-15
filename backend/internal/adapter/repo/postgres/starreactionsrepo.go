package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
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

// Claim занимает ключ идемпотентности (user_id, random_id) запроса. INSERT … ON CONFLICT DO
// NOTHING: параллельный дубль блокируется на уникальном ключе до коммита первой транзакции и
// затем видит конфликт; если первая откатилась (например, не хватило звёзд), дубль проходит
// как новый. Ключи пользователя старше суток чистятся (окно повтора — потерянный ответ).
func (r *StarReactionsRepo) Claim(ctx context.Context, userID, randomID, messageID, count int64) (bool, error) {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`DELETE FROM star_reaction_requests WHERE user_id = $1 AND created_at < now() - interval '1 day'`,
		userID); err != nil {
		return false, err
	}
	var one int
	err := q.QueryRow(ctx,
		`INSERT INTO star_reaction_requests (user_id, random_id, message_id, stars)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (user_id, random_id) DO NOTHING
		 RETURNING 1`,
		userID, randomID, messageID, count).Scan(&one)
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	var prevMsg, prevCount int64
	if err := q.QueryRow(ctx,
		`SELECT message_id, stars FROM star_reaction_requests WHERE user_id = $1 AND random_id = $2`,
		userID, randomID).Scan(&prevMsg, &prevCount); err != nil {
		return false, err
	}
	if prevMsg != messageID || prevCount != count {
		return false, domain.ErrInvalid
	}
	return false, nil
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
func (r *StarReactionsRepo) TopSenders(ctx context.Context, viewerID, messageID int64, limit int) ([]domain.StarReactionSender, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+userSeenCols("u.", "$3")+`, sr.stars, sr.anonymous
		   FROM star_reactions sr
		   JOIN users u ON u.id = sr.user_id
		  WHERE sr.message_id = $1
		  ORDER BY sr.stars DESC, sr.updated_at ASC
		  LIMIT $2`,
		messageID, limit, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.StarReactionSender, 0)
	for rows.Next() {
		var s domain.StarReactionSender
		var u userSeenScan
		if e := rows.Scan(append(u.dest(), &s.Stars, &s.Anonymous)...); e != nil {
			return nil, e
		}
		s.User = u.user(true)
		out = append(out, s)
	}
	return out, rows.Err()
}
