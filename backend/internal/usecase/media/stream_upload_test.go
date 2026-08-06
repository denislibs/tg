package media

import (
	"bytes"
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// TestGetContentBeforeStreamed — guardrail (design §5, guardrail 2): if a
// media row exists (CreateUpload) but the stream write has not finished (the
// object was never PutObject'd into storage), GetContent must error, not
// return partial/empty bytes. Otherwise a 206 Content-Range response could
// race the in-flight PUT/multipart-assemble and desync from the real object.
func TestGetContentBeforeStreamed(t *testing.T) {
	st := &fakeStorage{} // object "k" intentionally NOT written
	svc := New(&fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k"}}, st, nil)
	if _, _, _, err := svc.GetContent(context.Background(), 42); err == nil {
		t.Fatal("GetContent on an unfinalized object must error, not return bytes")
	}
}

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
	repo := &fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k", Mime: "video/mp4", Size: 6}}
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
	su := NewStreamUploads(New(&fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k", Size: 9}}, &fakeStorage{}, nil))
	if _, err := su.WriteChunk(context.Background(), 7, 42, 0, 9, []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	// expected offset=3, sending 6 → order error
	if _, err := su.WriteChunk(context.Background(), 7, 42, 6, 9, []byte{7, 8, 9}); err == nil {
		t.Fatal("out-of-order offset must error")
	}
}

func TestStreamUploadForbidden(t *testing.T) {
	su := NewStreamUploads(New(&fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k", Size: 3}}, &fakeStorage{}, nil))
	_, err := su.WriteChunk(context.Background(), 999, 42, 0, 3, []byte{1, 2, 3}) // not the owner
	if err != ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

// TestStreamUploadForbiddenMidStream — fix-round 1, item 1 (authorization
// bypass): the session must recheck ownership on EVERY chunk, not only on the
// first one that creates it. Otherwise another user who knows/guesses the
// mediaID and the next expected offset can inject bytes into someone else's
// in-flight upload.
func TestStreamUploadForbiddenMidStream(t *testing.T) {
	su := NewStreamUploads(New(&fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k", Size: 9}}, &fakeStorage{}, nil))
	ctx := context.Background()

	// Legit owner opens the session with the first chunk.
	if _, err := su.WriteChunk(ctx, 7, 42, 0, 9, []byte{1, 2, 3}); err != nil {
		t.Fatalf("owner chunk1: %v", err)
	}
	// A different user sends the next (correctly-ordered) chunk — must be
	// rejected even though the offset matches, because the session is not theirs.
	if _, err := su.WriteChunk(ctx, 999, 42, 3, 9, []byte{4, 5, 6}); err != ErrForbidden {
		t.Fatalf("expected ErrForbidden for non-owner mid-stream chunk, got %v", err)
	}
}

// TestStreamUploadTotalMismatch — fix-round 1, item 2 (resource-cap bypass):
// total must match the media row's declared Size; a client cannot open a
// session for a small CreateUpload and then stream an arbitrarily large total.
func TestStreamUploadTotalMismatch(t *testing.T) {
	su := NewStreamUploads(New(&fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k", Size: 1024}}, &fakeStorage{}, nil))
	_, err := su.WriteChunk(context.Background(), 7, 42, 0, 10<<30, []byte{1, 2, 3}) // total=10GiB vs Size=1KiB
	if err == nil {
		t.Fatal("total != m.Size must error")
	}
}

// TestStreamUploadOverCap — fix-round 1, item 2: a chunk that would write past
// the declared total must be rejected before it reaches the pipe/storage.
func TestStreamUploadOverCap(t *testing.T) {
	su := NewStreamUploads(New(&fakeRepo{m: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k", Size: 6}}, &fakeStorage{}, nil))
	_, err := su.WriteChunk(context.Background(), 7, 42, 0, 6, []byte{1, 2, 3, 4, 5, 6, 7, 8}) // 8 bytes > total 6
	if err == nil {
		t.Fatal("chunk exceeding total must error")
	}
}
