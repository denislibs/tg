package media

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

type fakeStorage struct{}

func (fakeStorage) Bucket() string { return "media" }
func (fakeStorage) PresignedPut(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/put/" + key, nil
}
func (fakeStorage) PresignedGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/get/" + key, nil
}

func TestService_CreateUploadAndGet(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	s := NewService(repo, fakeStorage{})
	ctx := context.Background()
	owner := seedUser(t, repo, "+700")

	m, uploadURL, err := s.CreateUpload(ctx, UploadInput{OwnerID: owner, Mime: "image/jpeg", Size: 2048, Width: 100, Height: 100})
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	if m.ID == 0 || uploadURL == "" {
		t.Fatalf("bad result: %+v url=%q", m, uploadURL)
	}

	got, downloadURL, err := s.GetMedia(ctx, m.ID)
	if err != nil || got.ID != m.ID || downloadURL == "" {
		t.Fatalf("GetMedia = %+v, %q, %v", got, downloadURL, err)
	}
}

func TestService_RejectsBadSize(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(NewRepo(pool), fakeStorage{})
	ctx := context.Background()
	// Size guards fire before any DB write, so no user needs to exist.
	if _, _, err := s.CreateUpload(ctx, UploadInput{OwnerID: 1, Size: maxSize + 1}); err != ErrTooLarge {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
	if _, _, err := s.CreateUpload(ctx, UploadInput{OwnerID: 1, Size: 0}); err != ErrBadSize {
		t.Fatalf("expected ErrBadSize, got %v", err)
	}
}
