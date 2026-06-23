package media

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeRepo struct {
	rows   map[int64]domain.Media
	nextID int64
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[int64]domain.Media{}} }

func (r *fakeRepo) Create(_ context.Context, m domain.Media) (domain.Media, error) {
	r.nextID++
	m.ID = r.nextID
	m.CreatedAt = time.Now()
	r.rows[m.ID] = m
	return m, nil
}

func (r *fakeRepo) GetByID(_ context.Context, id int64) (domain.Media, error) {
	m, ok := r.rows[id]
	if !ok {
		return domain.Media{}, domain.ErrNotFound
	}
	return m, nil
}

type fakeStorage struct{}

func (fakeStorage) Bucket() string { return "media" }
func (fakeStorage) PresignedPut(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://put/" + key, nil
}
func (fakeStorage) PresignedGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://get/" + key, nil
}

func TestInteractor_CreateUploadAndGet(t *testing.T) {
	s := New(newFakeRepo(), fakeStorage{})
	ctx := context.Background()

	m, uploadURL, err := s.CreateUpload(ctx, UploadInput{OwnerID: 7, Mime: "image/jpeg", Size: 2048, Width: 100, Height: 100})
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	if m.ID == 0 || uploadURL == "" {
		t.Fatalf("bad result: %+v url=%q", m, uploadURL)
	}
	if m.Bucket != "media" {
		t.Fatalf("bucket = %q, want media", m.Bucket)
	}

	got, downloadURL, err := s.GetMedia(ctx, m.ID)
	if err != nil || got.ID != m.ID || downloadURL == "" {
		t.Fatalf("GetMedia = %+v, %q, %v", got, downloadURL, err)
	}
	if got.Mime != "image/jpeg" || got.Width != 100 {
		t.Fatalf("GetMedia metadata = %+v", got)
	}
}

func TestInteractor_GetMediaNotFound(t *testing.T) {
	s := New(newFakeRepo(), fakeStorage{})
	if _, _, err := s.GetMedia(context.Background(), 999999); err != domain.ErrNotFound {
		t.Fatalf("expected domain.ErrNotFound, got %v", err)
	}
}

func TestInteractor_RejectsBadSize(t *testing.T) {
	s := New(newFakeRepo(), fakeStorage{})
	ctx := context.Background()
	if _, _, err := s.CreateUpload(ctx, UploadInput{OwnerID: 1, Size: maxSize + 1}); err != ErrTooLarge {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
	if _, _, err := s.CreateUpload(ctx, UploadInput{OwnerID: 1, Size: 0}); err != ErrBadSize {
		t.Fatalf("expected ErrBadSize, got %v", err)
	}
}
