package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestAuthRepo_CodeLifecycle(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
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
	if _, err := repo.GetCode(ctx, "+700"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound after delete, got %v", err)
	}
}

func TestAuthRepo_ExpiredCode(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()
	_ = repo.SaveCode(ctx, "+701", "12345", time.Now().Add(-time.Minute))
	if _, err := repo.GetCode(ctx, "+701"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound for expired, got %v", err)
	}
}

func TestAuthRepo_UserAndDeviceAndToken(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()

	u1, err := repo.UpsertByPhone(ctx, "+702")
	if err != nil {
		t.Fatalf("UpsertByPhone: %v", err)
	}
	u2, _ := repo.UpsertByPhone(ctx, "+702")
	if u1.ID != u2.ID {
		t.Fatalf("upsert created duplicate user: %d != %d", u1.ID, u2.ID)
	}

	_, err = repo.Create(ctx, u1.ID, "web", "browser", "hash-abc", "", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, _, err := repo.SessionByTokenHash(ctx, "hash-abc")
	if err != nil {
		t.Fatalf("SessionByTokenHash: %v", err)
	}
	if got.ID != u1.ID {
		t.Fatalf("resolved wrong user: %d != %d", got.ID, u1.ID)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "missing"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound for missing token, got %v", err)
	}
}

func TestAuthRepo_SessionListDelete(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()

	u, _ := repo.UpsertByPhone(ctx, "+790")
	d1, _ := repo.Create(ctx, u.ID, "web", "browser", "hash-1", "1.2.3.4", "Almaty, Kazakhstan")
	_, _ = repo.Create(ctx, u.ID, "phone", "ios", "hash-2", "", "")

	// SessionByTokenHash resolves user + device.
	gotUser, gotDevice, err := repo.SessionByTokenHash(ctx, "hash-1")
	if err != nil || gotUser.ID != u.ID || gotDevice != d1.ID {
		t.Fatalf("SessionByTokenHash = %v, %d, %v", gotUser, gotDevice, err)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "missing"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound, got %v", err)
	}

	// ListByUser returns both.
	devices, err := repo.ListByUser(ctx, u.ID)
	if err != nil || len(devices) != 2 {
		t.Fatalf("ListByUser = %v, %v", devices, err)
	}

	// Delete returns the token hash and removes it.
	th, found, err := repo.Delete(ctx, u.ID, d1.ID)
	if err != nil || !found || th != "hash-1" {
		t.Fatalf("Delete = %q, %v, %v", th, found, err)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "hash-1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected device gone, got %v", err)
	}
	// Deleting a non-existent / other-user device reports not found.
	if _, found, _ := repo.Delete(ctx, u.ID, 99999); found {
		t.Fatal("expected found=false for unknown device")
	}
}
