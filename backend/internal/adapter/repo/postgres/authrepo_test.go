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

func TestAuthRepo_ProfilePhotoGallery(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()

	u, _ := repo.UpsertByPhone(ctx, "+7100")

	// Adding photos promotes each to the current avatar and lists newest-first.
	p1, err := repo.AddProfilePhoto(ctx, u.ID, "/media/1/content", "")
	if err != nil || p1.ID == 0 {
		t.Fatalf("AddProfilePhoto p1: %v", err)
	}
	p2, err := repo.AddProfilePhoto(ctx, u.ID, "/media/2/content", "/media/22/content")
	if err != nil {
		t.Fatalf("AddProfilePhoto p2: %v", err)
	}
	got, _ := repo.GetByID(ctx, u.ID)
	if got.AvatarURL != "/media/2/content" {
		t.Fatalf("avatar_url after add = %q, want /media/2/content", got.AvatarURL)
	}
	list, err := repo.ListProfilePhotos(ctx, u.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("ListProfilePhotos = %v (len %d), %v", list, len(list), err)
	}
	if list[0].ID != p2.ID || list[1].ID != p1.ID {
		t.Fatalf("expected newest-first order, got %d then %d", list[0].ID, list[1].ID)
	}
	if list[0].VideoURL != "/media/22/content" {
		t.Fatalf("video_url = %q, want /media/22/content", list[0].VideoURL)
	}

	// Deleting the current avatar (p2) falls back to the next most-recent (p1).
	newURL, err := repo.DeleteProfilePhoto(ctx, u.ID, p2.ID)
	if err != nil || newURL != "/media/1/content" {
		t.Fatalf("DeleteProfilePhoto(current) newURL = %q, %v", newURL, err)
	}
	got, _ = repo.GetByID(ctx, u.ID)
	if got.AvatarURL != "/media/1/content" {
		t.Fatalf("avatar_url after delete = %q, want /media/1/content", got.AvatarURL)
	}

	// Deleting the last photo clears the avatar.
	newURL, err = repo.DeleteProfilePhoto(ctx, u.ID, p1.ID)
	if err != nil || newURL != "" {
		t.Fatalf("DeleteProfilePhoto(last) newURL = %q, %v", newURL, err)
	}

	// Deleting another user's / unknown photo is a no-op returning the unchanged avatar.
	other, _ := repo.UpsertByPhone(ctx, "+7101")
	op, _ := repo.AddProfilePhoto(ctx, other.ID, "/media/9/content", "")
	newURL, err = repo.DeleteProfilePhoto(ctx, u.ID, op.ID)
	if err != nil || newURL != "" {
		t.Fatalf("DeleteProfilePhoto(other) newURL = %q, %v (should be no-op)", newURL, err)
	}
	otherList, _ := repo.ListProfilePhotos(ctx, other.ID)
	if len(otherList) != 1 {
		t.Fatalf("other user's photo should survive, got %d", len(otherList))
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
