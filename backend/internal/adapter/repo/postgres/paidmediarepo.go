package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// PaidMediaRepo — цена платного медиа (paid_media) и разблокировки
// (paid_media_unlocks). Реализует usecasechat.PaidMediaRepo.
type PaidMediaRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.PaidMediaRepo = (*PaidMediaRepo)(nil)

func NewPaidMediaRepo(pool *pgxpool.Pool) *PaidMediaRepo { return &PaidMediaRepo{pool: pool} }

// SetPrice помечает медиа сообщения платным с ценой price (в звёздах). UPSERT —
// повторная установка перезаписывает цену.
func (r *PaidMediaRepo) SetPrice(ctx context.Context, messageID, price int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO paid_media (message_id, price_stars) VALUES ($1,$2)
		 ON CONFLICT (message_id) DO UPDATE SET price_stars = EXCLUDED.price_stars`,
		messageID, price)
	return err
}

// PricesByIDs возвращает цены платного медиа для указанных сообщений (сообщения
// без цены отсутствуют в мапе). Пустой вход → пустая мапа.
func (r *PaidMediaRepo) PricesByIDs(ctx context.Context, ids []int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT message_id, price_stars FROM paid_media WHERE message_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, price int64
		if e := rows.Scan(&id, &price); e != nil {
			return nil, e
		}
		out[id] = price
	}
	return out, rows.Err()
}

// UnlockedByIDs возвращает множество сообщений (из ids), которые пользователь уже
// разблокировал. Пустой вход → пустая мапа.
func (r *PaidMediaRepo) UnlockedByIDs(ctx context.Context, userID int64, ids []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT message_id FROM paid_media_unlocks WHERE user_id=$1 AND message_id = ANY($2)`, userID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if e := rows.Scan(&id); e != nil {
			return nil, e
		}
		out[id] = true
	}
	return out, rows.Err()
}

// Unlock записывает разблокировку (message,user); true — если запись новая
// (идемпотентно: повтор возвращает false, не ошибку).
func (r *PaidMediaRepo) Unlock(ctx context.Context, messageID, userID int64) (bool, error) {
	tag, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO paid_media_unlocks (message_id, user_id) VALUES ($1,$2)
		 ON CONFLICT DO NOTHING`, messageID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// LockedMedia сообщает, закрыто ли медиа платным баром для пользователя: есть
// платное сообщение, ссылающееся на это медиа, автор которого не userID и которое
// userID ещё не разблокировал. Используется для гейта скачивания байтов медиа.
func (r *PaidMediaRepo) LockedMedia(ctx context.Context, userID, mediaID int64) (bool, error) {
	var locked bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM paid_media pm
			JOIN messages m ON m.id = pm.message_id
			WHERE m.media_id = $2 AND m.sender_id <> $1
			  AND NOT EXISTS (
				SELECT 1 FROM paid_media_unlocks u
				WHERE u.message_id = pm.message_id AND u.user_id = $1)
		)`, userID, mediaID).Scan(&locked)
	return locked, err
}
