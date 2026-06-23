package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestPushRepo_SubscriptionLifecycle(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewPushRepo(pool)
	ctx := context.Background()

	var userID, deviceID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ('+700','Alice') RETURNING id`).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO devices (user_id, token_hash) VALUES ($1,'tok1') RETURNING id`, userID).Scan(&deviceID); err != nil {
		t.Fatalf("seed device: %v", err)
	}

	sub := domain.PushSubscription{Endpoint: "https://push/ep1", P256dh: "p1", Auth: "a1"}
	if err := repo.Add(ctx, deviceID, sub); err != nil {
		t.Fatalf("Add: %v", err)
	}

	subs, err := repo.ForUser(ctx, userID)
	if err != nil || len(subs) != 1 {
		t.Fatalf("ForUser = %+v, %v", subs, err)
	}
	if subs[0] != sub {
		t.Fatalf("ForUser sub = %+v, want %+v", subs[0], sub)
	}

	// Upsert: same endpoint, rotated keys, original device kept.
	upd := domain.PushSubscription{Endpoint: "https://push/ep1", P256dh: "p2", Auth: "a2"}
	if err := repo.Add(ctx, deviceID, upd); err != nil {
		t.Fatalf("Add upsert: %v", err)
	}
	subs, _ = repo.ForUser(ctx, userID)
	if len(subs) != 1 || subs[0].P256dh != "p2" || subs[0].Auth != "a2" {
		t.Fatalf("upsert keys not refreshed: %+v", subs)
	}

	if err := repo.DeleteByEndpoint(ctx, "https://push/ep1"); err != nil {
		t.Fatalf("DeleteByEndpoint: %v", err)
	}
	subs, _ = repo.ForUser(ctx, userID)
	if len(subs) != 0 {
		t.Fatalf("expected 0 subs after delete, got %d", len(subs))
	}
}

func TestPushRepo_IsMuted(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewPushRepo(pool)
	ctx := context.Background()

	var userID, chatID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ('+701','Bob') RETURNING id`).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type) VALUES ('group') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}

	// Not a member → false, no error.
	if muted, err := repo.IsMuted(ctx, chatID, userID); err != nil || muted {
		t.Fatalf("IsMuted(non-member) = %v, %v; want false,nil", muted, err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id, muted) VALUES ($1,$2,false)`, chatID, userID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	if muted, err := repo.IsMuted(ctx, chatID, userID); err != nil || muted {
		t.Fatalf("IsMuted(unmuted) = %v, %v; want false,nil", muted, err)
	}

	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET muted=true WHERE chat_id=$1 AND user_id=$2`, chatID, userID); err != nil {
		t.Fatalf("update muted: %v", err)
	}
	if muted, err := repo.IsMuted(ctx, chatID, userID); err != nil || !muted {
		t.Fatalf("IsMuted(muted) = %v, %v; want true,nil", muted, err)
	}
}

func TestPushRepo_Enricher(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewPushRepo(pool)
	ctx := context.Background()

	var senderID, userID, chatID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ('+702','Carol') RETURNING id`).Scan(&senderID); err != nil {
		t.Fatalf("seed sender: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ('+703','Dave') RETURNING id`).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type) VALUES ('group') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id, unread_count) VALUES ($1,$2,3)`, chatID, userID); err != nil {
		t.Fatalf("seed member: %v", err)
	}

	name, err := repo.SenderName(ctx, senderID)
	if err != nil || name != "Carol" {
		t.Fatalf("SenderName = %q, %v; want Carol", name, err)
	}

	badge, err := repo.UnreadBadge(ctx, userID)
	if err != nil || badge != 3 {
		t.Fatalf("UnreadBadge = %d, %v; want 3", badge, err)
	}

	// User with no memberships → 0.
	if badge, err := repo.UnreadBadge(ctx, senderID); err != nil || badge != 0 {
		t.Fatalf("UnreadBadge(none) = %d, %v; want 0", badge, err)
	}
}
