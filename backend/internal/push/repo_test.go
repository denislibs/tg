package push

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestRepo_SubscriptionLifecycle(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	var userID, deviceID int64
	_ = pool.QueryRow(ctx, `INSERT INTO users (phone, display_name) VALUES ('+700','+700') RETURNING id`).Scan(&userID)
	_ = pool.QueryRow(ctx, `INSERT INTO devices (user_id, token_hash) VALUES ($1,'h1') RETURNING id`, userID).Scan(&deviceID)

	sub := Subscription{Endpoint: "https://push/abc", P256dh: "p", Auth: "a"}
	if err := repo.AddSubscription(ctx, deviceID, sub); err != nil {
		t.Fatalf("add: %v", err)
	}
	// Upsert (same endpoint) does not duplicate.
	_ = repo.AddSubscription(ctx, deviceID, sub)

	subs, err := repo.SubscriptionsForUser(ctx, userID)
	if err != nil || len(subs) != 1 || subs[0].Endpoint != "https://push/abc" {
		t.Fatalf("subs = %+v, %v", subs, err)
	}
	if err := repo.DeleteByEndpoint(ctx, "https://push/abc"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	subs, _ = repo.SubscriptionsForUser(ctx, userID)
	if len(subs) != 0 {
		t.Fatalf("expected no subs after delete, got %d", len(subs))
	}
}
