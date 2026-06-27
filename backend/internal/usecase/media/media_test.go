package media

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeRepo struct {
	rows   map[int64]domain.Media
	nextID int64
	// m, when set, is returned by GetByID for any id (single-row convenience for
	// content tests).
	m domain.Media
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[int64]domain.Media{}} }

func (r *fakeRepo) Create(_ context.Context, m domain.Media) (domain.Media, error) {
	if r.rows == nil {
		r.rows = map[int64]domain.Media{}
	}
	r.nextID++
	m.ID = r.nextID
	m.CreatedAt = time.Now()
	r.rows[m.ID] = m
	return m, nil
}

func (r *fakeRepo) GetByID(_ context.Context, id int64) (domain.Media, error) {
	if r.rows != nil {
		if m, ok := r.rows[id]; ok {
			return m, nil
		}
	}
	if r.m.ID != 0 {
		return r.m, nil
	}
	return domain.Media{}, domain.ErrNotFound
}

func (r *fakeRepo) UpdateProcessed(_ context.Context, _ int64, _, _, _ int, _ string) error {
	return nil
}

type fakeStorage struct{ blobs map[string][]byte }

func newFakeStorage() *fakeStorage { return &fakeStorage{blobs: map[string][]byte{}} }

func (*fakeStorage) Bucket() string { return "media" }
func (*fakeStorage) PresignedPut(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://put/" + key, nil
}
func (*fakeStorage) PresignedGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://get/" + key, nil
}
func (f *fakeStorage) PutObject(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	b, _ := io.ReadAll(r)
	if f.blobs == nil {
		f.blobs = map[string][]byte{}
	}
	f.blobs[key] = b
	return nil
}
func (f *fakeStorage) GetObject(_ context.Context, key string) (io.ReadSeekCloser, ObjectInfo, error) {
	b, ok := f.blobs[key]
	if !ok {
		return nil, ObjectInfo{}, domain.ErrNotFound
	}
	return nopSeekCloser{bytes.NewReader(b)}, ObjectInfo{Size: int64(len(b)), ContentType: "application/octet-stream"}, nil
}

type nopSeekCloser struct{ *bytes.Reader }

func (nopSeekCloser) Close() error { return nil }

func TestInteractor_CreateUploadAndGet(t *testing.T) {
	s := New(newFakeRepo(), newFakeStorage(), nil)
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
	s := New(newFakeRepo(), newFakeStorage(), nil)
	if _, _, err := s.GetMedia(context.Background(), 999999); err != domain.ErrNotFound {
		t.Fatalf("expected domain.ErrNotFound, got %v", err)
	}
}

func TestInteractor_RejectsBadSize(t *testing.T) {
	s := New(newFakeRepo(), newFakeStorage(), nil)
	ctx := context.Background()
	if _, _, err := s.CreateUpload(ctx, UploadInput{OwnerID: 1, Size: maxSize + 1}); err != ErrTooLarge {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
	if _, _, err := s.CreateUpload(ctx, UploadInput{OwnerID: 1, Size: 0}); err != ErrBadSize {
		t.Fatalf("expected ErrBadSize, got %v", err)
	}
}

func TestPutContent_OwnerOnly(t *testing.T) {
	repo := &fakeRepo{m: domain.Media{ID: 1, OwnerID: 7, ObjectKey: "7/x", Mime: "image/png", Size: 5}}
	st := newFakeStorage()
	s := New(repo, st, nil)
	if err := s.PutContent(context.Background(), 1, 7, bytes.NewReader([]byte("12345")), 5); err != nil {
		t.Fatalf("owner put: %v", err)
	}
	if err := s.PutContent(context.Background(), 1, 99, bytes.NewReader([]byte("12345")), 5); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-owner = %v, want ErrForbidden", err)
	}
}

func TestGetContent(t *testing.T) {
	repo := &fakeRepo{m: domain.Media{ID: 1, OwnerID: 7, ObjectKey: "7/x", Mime: "image/png", Size: 3}}
	st := newFakeStorage()
	_ = st.PutObject(context.Background(), "7/x", bytes.NewReader([]byte("abc")), 3, "image/png")
	s := New(repo, st, nil)
	rc, info, m, err := s.GetContent(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	if m.Mime != "image/png" || info.Size != 3 {
		t.Fatalf("meta wrong: %+v %+v", m, info)
	}
	got, _ := io.ReadAll(rc)
	if string(got) != "abc" {
		t.Fatalf("body=%q", got)
	}
}
