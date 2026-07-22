package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PremiumRepo читает и выдаёт premium-статус (users.is_premium). Используется
// бустами (буст доступен только premium) и розыгрышами (premium-приз выдаётся
// победителям). Отдельный порт, чтобы chat-usecase не тянул auth-репозиторий.
type PremiumRepo struct {
	pool *pgxpool.Pool
}

func NewPremiumRepo(pool *pgxpool.Pool) *PremiumRepo { return &PremiumRepo{pool: pool} }

func (r *PremiumRepo) IsPremium(ctx context.Context, userID int64) (bool, error) {
	var premium bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT is_premium FROM users WHERE id=$1`, userID).Scan(&premium)
	return premium, err
}

func (r *PremiumRepo) GrantPremium(ctx context.Context, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE users SET is_premium=true WHERE id=$1`, userID)
	return err
}
