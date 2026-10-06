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

// SetPrice помечает медиа сообщения платным с ценой price (в звёздах); sourceID —
// сообщение-предложение копии (0 — своё). UPSERT — повтор перезаписывает.
func (r *PaidMediaRepo) SetPrice(ctx context.Context, messageID, price, sourceID int64) error {
	var src any
	if sourceID != 0 {
		src = sourceID
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO paid_media (message_id, price_stars, source_message_id) VALUES ($1,$2,$3)
		 ON CONFLICT (message_id) DO UPDATE SET price_stars = EXCLUDED.price_stars,
		   source_message_id = EXCLUDED.source_message_id`,
		messageID, price, src)
	return err
}

// Offers — платные сообщения из ids: цена, предложение (source_message_id или
// само сообщение) и продавец — автор предложения (0, если его строки нет).
func (r *PaidMediaRepo) Offers(ctx context.Context, ids []int64) (map[int64]usecasechat.PaidOffer, error) {
	out := map[int64]usecasechat.PaidOffer{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT pm.message_id, pm.price_stars, COALESCE(pm.source_message_id, pm.message_id),
		        COALESCE(o.sender_id, 0)
		   FROM paid_media pm
		   LEFT JOIN messages o ON o.id = COALESCE(pm.source_message_id, pm.message_id)
		  WHERE pm.message_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var o usecasechat.PaidOffer
		if e := rows.Scan(&id, &o.Price, &o.OfferID, &o.SellerID); e != nil {
			return nil, e
		}
		out[id] = o
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

// Unlock записывает разблокировку (предложение, user); true — если запись новая
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
// платное сообщение, ссылающееся на это медиа, продавец которого (автор
// предложения) не userID и чьё предложение userID ещё не разблокировал.
// Используется для гейта скачивания байтов медиа.
func (r *PaidMediaRepo) LockedMedia(ctx context.Context, userID, mediaID int64) (bool, error) {
	var locked bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM paid_media pm
			JOIN messages m ON m.id = pm.message_id
			LEFT JOIN messages o ON o.id = COALESCE(pm.source_message_id, pm.message_id)
			WHERE m.media_id = $2 AND COALESCE(o.sender_id, 0) <> $1
			  AND NOT EXISTS (
				SELECT 1 FROM paid_media_unlocks u
				WHERE u.message_id = COALESCE(pm.source_message_id, pm.message_id) AND u.user_id = $1)
		)`, userID, mediaID).Scan(&locked)
	return locked, err
}
