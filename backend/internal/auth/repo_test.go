package auth

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestRepo_CodeLifecycle(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	if err := repo.SaveCode(ctx, "+700", "12345", time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("SaveCode: %v", err)
	}
	got, err := repo.GetCode(ctx, "+700")
	if err != nil || got != "12345" {
		t.Fatalf("GetCode = %q, %v", got, err)
	}
	if err := repo.DeleteCode(ctx, "+700"); err != nil {
		t.Fatalf("DeleteCode: %v", err)
	}
	if _, err := repo.GetCode(ctx, "+700"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestRepo_ExpiredCode(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()
	_ = repo.SaveCode(ctx, "+701", "12345", time.Now().Add(-time.Minute))
	if _, err := repo.GetCode(ctx, "+701"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for expired, got %v", err)
	}
}

func TestRepo_UserAndDeviceAndToken(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	u1, err := repo.UpsertUserByPhone(ctx, "+702")
	if err != nil {
		t.Fatalf("UpsertUserByPhone: %v", err)
	}
	u2, _ := repo.UpsertUserByPhone(ctx, "+702")
	if u1.ID != u2.ID {
		t.Fatalf("upsert created duplicate user: %d != %d", u1.ID, u2.ID)
	}

	_, err = repo.CreateDevice(ctx, u1.ID, "web", "browser", "hash-abc")
	if err != nil {
		t.Fatalf("CreateDevice: %v", err)
	}
	got, err := repo.UserByTokenHash(ctx, "hash-abc")
	if err != nil {
		t.Fatalf("UserByTokenHash: %v", err)
	}
	if got.ID != u1.ID {
		t.Fatalf("resolved wrong user: %d != %d", got.ID, u1.ID)
	}
	if _, err := repo.UserByTokenHash(ctx, "missing"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for missing token, got %v", err)
	}
}
