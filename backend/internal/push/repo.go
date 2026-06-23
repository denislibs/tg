// Package push delivers Web Push notifications to offline users.
package push

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Subscription is a browser Web Push subscription.
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

// AddSubscription upserts a subscription for a device (keyed by endpoint).
func (r *Repo) AddSubscription(ctx context.Context, deviceID int64, s Subscription) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (endpoint) DO UPDATE SET device_id=$1, p256dh=$3, auth=$4`,
		deviceID, s.Endpoint, s.P256dh, s.Auth)
	return err
}

// SubscriptionsForUser returns all push subscriptions across a user's devices.
func (r *Repo) SubscriptionsForUser(ctx context.Context, userID int64) ([]Subscription, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
		 JOIN devices d ON d.id = ps.device_id WHERE d.user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Subscription
	for rows.Next() {
		var s Subscription
		if err := rows.Scan(&s.Endpoint, &s.P256dh, &s.Auth); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteByEndpoint removes a (likely expired) subscription.
func (r *Repo) DeleteByEndpoint(ctx context.Context, endpoint string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint=$1`, endpoint)
	return err
}
