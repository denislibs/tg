package http

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// Переиспользует fakeMediaRepo/fakeStorage/fakeAccess из media_handler_test.go
// (тот же пакет) — реальный usecasemedia.Interactor поверх них.
func newTestStreamer(allow bool, body []byte) *FileStreamer {
	repo := &fakeMediaRepo{m: domain.Media{ID: 2, ObjectKey: "k"}}
	storage := newFakeStorage()
	storage.blobs["k"] = body
	svc := usecasemedia.New(repo, storage, nil)
	return NewFileStreamer(fakeAccess{allow: allow}, svc)
}

func TestReadPartOffsetLimit(t *testing.T) {
	data, total, err := newTestStreamer(true, []byte("0123456789")).ReadPart(context.Background(), 1, 2, 3, 4)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if total != 10 {
		t.Fatalf("total = %d", total)
	}
	if string(data) != "3456" {
		t.Fatalf("data = %q", data)
	}
}

func TestReadPartClampAtEOF(t *testing.T) {
	data, total, err := newTestStreamer(true, []byte("0123456789")).ReadPart(context.Background(), 1, 2, 8, 512)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if string(data) != "89" || total != 10 {
		t.Fatalf("data=%q total=%d", data, total)
	}
}

func TestReadPartForbidden(t *testing.T) {
	_, _, err := newTestStreamer(false, []byte("x")).ReadPart(context.Background(), 1, 2, 0, 512)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}
