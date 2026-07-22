package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BoostsRepo хранит бусты каналов (таблица channel_boosts). Активными считаются
// бусты с expires_at > now().
type BoostsRepo struct {
	pool *pgxpool.Pool
}

func NewBoostsRepo(pool *pgxpool.Pool) *BoostsRepo { return &BoostsRepo{pool: pool} }

// ActiveBoosts — сумма slots всех непросроченных бустов канала.
func (r *BoostsRepo) ActiveBoosts(ctx context.Context, chatID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(SUM(slots), 0) FROM channel_boosts WHERE chat_id=$1 AND expires_at > now()`,
		chatID).Scan(&n)
	return n, err
}

// UserActiveSlots — сколько слотов пользователь уже потратил (по всем каналам,
// без просроченных).
func (r *BoostsRepo) UserActiveSlots(ctx context.Context, userID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(SUM(slots), 0) FROM channel_boosts WHERE user_id=$1 AND expires_at > now()`,
		userID).Scan(&n)
	return n, err
}

// Boost добавляет буст канала; повторный активный буст того же канала обновляет
// срок (UPSERT), не наращивая слоты.
func (r *BoostsRepo) Boost(ctx context.Context, chatID, userID int64, slots int, expiresAt time.Time) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO channel_boosts (chat_id, user_id, slots, expires_at) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (chat_id, user_id) DO UPDATE SET slots=$3, expires_at=$4, created_at=now()`,
		chatID, userID, slots, expiresAt)
	return err
}

// BoostedByMe — есть ли активный буст пользователя на этот канал.
func (r *BoostsRepo) BoostedByMe(ctx context.Context, chatID, userID int64) (bool, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM channel_boosts WHERE chat_id=$1 AND user_id=$2 AND expires_at > now()`,
		chatID, userID).Scan(&n)
	return n > 0, err
}
