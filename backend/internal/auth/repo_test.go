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

func TestRepo_SessionListDelete(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	u, _ := repo.UpsertUserByPhone(ctx, "+790")
	d1, _ := repo.CreateDevice(ctx, u.ID, "web", "browser", "hash-1")
	_, _ = repo.CreateDevice(ctx, u.ID, "phone", "ios", "hash-2")

	// SessionByTokenHash resolves user + device.
	gotUser, gotDevice, err := repo.SessionByTokenHash(ctx, "hash-1")
	if err != nil || gotUser.ID != u.ID || gotDevice != d1.ID {
		t.Fatalf("SessionByTokenHash = %v, %d, %v", gotUser, gotDevice, err)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "missing"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	// ListDevices returns both.
	devices, err := repo.ListDevices(ctx, u.ID)
	if err != nil || len(devices) != 2 {
		t.Fatalf("ListDevices = %v, %v", devices, err)
	}

	// DeleteDevice returns the token hash and removes it.
	th, found, err := repo.DeleteDevice(ctx, u.ID, d1.ID)
	if err != nil || !found || th != "hash-1" {
		t.Fatalf("DeleteDevice = %q, %v, %v", th, found, err)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "hash-1"); err != ErrNotFound {
		t.Fatalf("expected device gone, got %v", err)
	}
	// Deleting a non-existent / other-user device reports not found.
	if _, found, _ := repo.DeleteDevice(ctx, u.ID, 99999); found {
		t.Fatal("expected found=false for unknown device")
	}
}
