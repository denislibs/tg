package media

import (
	"bytes"
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// get returns the blob stored under key (nil if absent) — test helper for
// asserting the object StreamUploads assembled via PutObject.
func (f *fakeStorage) get(key string) []byte {
	if f.blobs == nil {
		return nil
	}
	return f.blobs[key]
}

func TestStreamUploadAssembles(t *testing.T) {
	st := &fakeStorage{} // PutObject: io.ReadAll(r) → store by objectKey
	repo := &fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k", Mime: "video/mp4"}}
	svc := New(repo, st, nil) // processor nil
	su := NewStreamUploads(svc)
	ctx := context.Background()

	// total=6, two chunks of 3
	done, err := su.WriteChunk(ctx, 7, 42, 0, 6, []byte{1, 2, 3})
	if err != nil || done {
		t.Fatalf("chunk1: done=%v err=%v", done, err)
	}
	done, err = su.WriteChunk(ctx, 7, 42, 3, 6, []byte{4, 5, 6})
	if err != nil || !done {
		t.Fatalf("chunk2 (last): done=%v err=%v", done, err)
	}

	if got := st.get("k"); !bytes.Equal(got, []byte{1, 2, 3, 4, 5, 6}) {
		t.Fatalf("assembled object mismatch: %v", got)
	}
}

func TestStreamUploadOrder(t *testing.T) {
	su := NewStreamUploads(New(&fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k"}}, &fakeStorage{}, nil))
	if _, err := su.WriteChunk(context.Background(), 7, 42, 0, 9, []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	// expected offset=3, sending 6 → order error
	if _, err := su.WriteChunk(context.Background(), 7, 42, 6, 9, []byte{7, 8, 9}); err == nil {
		t.Fatal("out-of-order offset must error")
	}
}

func TestStreamUploadForbidden(t *testing.T) {
	su := NewStreamUploads(New(&fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k"}}, &fakeStorage{}, nil))
	_, err := su.WriteChunk(context.Background(), 999, 42, 0, 3, []byte{1, 2, 3}) // not the owner
	if err != ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}
