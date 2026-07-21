package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func seedMediaOwner(t *testing.T, repo *MediaRepo, phone string) int64 {
	t.Helper()
	var id int64
	err := repo.pool.QueryRow(context.Background(),
		`INSERT INTO users (phone, display_name) VALUES ($1,$1) RETURNING id`, phone).Scan(&id)
	if err != nil {
		t.Fatalf("seedMediaOwner: %v", err)
	}
	return id
}

func TestMediaRepo_CreateAndGet(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewMediaRepo(pool)
	ctx := context.Background()
	owner := seedMediaOwner(t, repo, "+700")

	m, err := repo.Create(ctx, domain.Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "k1", Mime: "image/jpeg",
		Size: 1024, Width: 800, Height: 600, BlurPreview: []byte{1, 2, 3},
	})
	if err != nil || m.ID == 0 {
		t.Fatalf("Create = %+v, %v", m, err)
	}
	got, err := repo.GetByID(ctx, m.ID)
	if err != nil || got.ObjectKey != "k1" || got.Width != 800 || len(got.BlurPreview) != 3 {
		t.Fatalf("GetByID = %+v, %v", got, err)
	}
	if _, err := repo.GetByID(ctx, 999999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound, got %v", err)
	}
}

func TestMediaRepo_ChunkedUploadTracking(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewMediaRepo(pool)
	ctx := context.Background()
	owner := seedMediaOwner(t, repo, "+701")

	m, err := repo.Create(ctx, domain.Media{OwnerID: owner, Bucket: "media", ObjectKey: "k2", Mime: "video/mp4", Size: 1})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// SetUploadID is set-once: a second call returns the first (winning) id.
	winner, err := repo.SetUploadID(ctx, m.ID, "up-A")
	if err != nil || winner != "up-A" {
		t.Fatalf("SetUploadID first = %q, %v", winner, err)
	}
	winner, err = repo.SetUploadID(ctx, m.ID, "up-B")
	if err != nil || winner != "up-A" {
		t.Fatalf("SetUploadID second = %q (want up-A), %v", winner, err)
	}
	if err := repo.SetUploadTotal(ctx, m.ID, 3); err != nil {
		t.Fatalf("SetUploadTotal: %v", err)
	}

	// SavePart upserts; re-saving a part overwrites its ETag.
	if err := repo.SavePart(ctx, m.ID, 2, "e2", 8); err != nil {
		t.Fatalf("SavePart 2: %v", err)
	}
	if err := repo.SavePart(ctx, m.ID, 1, "e1", 8); err != nil {
		t.Fatalf("SavePart 1: %v", err)
	}
	if err := repo.SavePart(ctx, m.ID, 1, "e1b", 8); err != nil {
		t.Fatalf("SavePart 1 re-upload: %v", err)
	}

	recv, err := repo.ReceivedParts(ctx, m.ID)
	if err != nil || len(recv) != 2 || recv[0] != 1 || recv[1] != 2 {
		t.Fatalf("ReceivedParts = %v, %v", recv, err)
	}
	parts, err := repo.PartsForComplete(ctx, m.ID)
	if err != nil || len(parts) != 2 || parts[0].PartNumber != 1 || parts[0].ETag != "e1b" {
		t.Fatalf("PartsForComplete = %+v, %v", parts, err)
	}

	// GetByID reflects the multipart bookkeeping.
	got, _ := repo.GetByID(ctx, m.ID)
	if got.UploadID != "up-A" || got.UploadTotal != 3 {
		t.Fatalf("GetByID upload state = %q/%d", got.UploadID, got.UploadTotal)
	}

	// ClearUpload wipes parts and resets the bookkeeping.
	if err := repo.ClearUpload(ctx, m.ID); err != nil {
		t.Fatalf("ClearUpload: %v", err)
	}
	recv, _ = repo.ReceivedParts(ctx, m.ID)
	got, _ = repo.GetByID(ctx, m.ID)
	if len(recv) != 0 || got.UploadID != "" || got.UploadTotal != 0 {
		t.Fatalf("after ClearUpload: recv=%v upload=%q/%d", recv, got.UploadID, got.UploadTotal)
	}
}
