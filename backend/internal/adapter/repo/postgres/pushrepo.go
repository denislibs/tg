package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasepush "github.com/messenger-denis/backend/internal/usecase/push"
)

// PushRepo implements the push usecase's SubRepo, MuteChecker, and Enricher
// ports — all are push-support queries over the same postgres tables.
type PushRepo struct{ pool *pgxpool.Pool }

func NewPushRepo(pool *pgxpool.Pool) *PushRepo { return &PushRepo{pool: pool} }

var (
	_ usecasepush.SubRepo     = (*PushRepo)(nil)
	_ usecasepush.MuteChecker = (*PushRepo)(nil)
	_ usecasepush.Enricher    = (*PushRepo)(nil)
)

// Add upserts a subscription for a device (keyed by endpoint). On conflict the
// original device_id is kept (the endpoint is owned by whoever first registered
// it) — only the rotating keys are refreshed.
func (r *PushRepo) Add(ctx context.Context, deviceID int64, s domain.PushSubscription) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (endpoint) DO UPDATE SET p256dh=$3, auth=$4`,
		deviceID, s.Endpoint, s.P256dh, s.Auth)
	return err
}

// ForUser returns all push subscriptions across a user's devices.
func (r *PushRepo) ForUser(ctx context.Context, userID int64) ([]domain.PushSubscription, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
		 JOIN devices d ON d.id = ps.device_id WHERE d.user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.PushSubscription
	for rows.Next() {
		var s domain.PushSubscription
		if err := rows.Scan(&s.Endpoint, &s.P256dh, &s.Auth); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteByEndpoint removes a (likely expired) subscription.
func (r *PushRepo) DeleteByEndpoint(ctx context.Context, endpoint string) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint=$1`, endpoint)
	return err
}

// IsMuted reports whether the user has muted the chat. Not a member → false.
func (r *PushRepo) IsMuted(ctx context.Context, chatID, userID int64) (bool, error) {
	var muted bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT muted FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&muted)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil // not a member → not muted
	}
	return muted, err
}

// SenderName returns the user's display name (empty if unknown).
func (r *PushRepo) SenderName(ctx context.Context, userID int64) (string, error) {
	var name string
	_ = querier(ctx, r.pool).QueryRow(ctx, `SELECT display_name FROM users WHERE id=$1`, userID).Scan(&name)
	return name, nil
}

// UnreadBadge returns the total unread count across the user's chats.
func (r *PushRepo) UnreadBadge(ctx context.Context, userID int64) (int, error) {
	var badge int
	// Aggregate with COALESCE always returns one row; best-effort on error.
	_ = querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(SUM(unread_count),0) FROM chat_members WHERE user_id=$1`,
		userID).Scan(&badge)
	return badge, nil
}
