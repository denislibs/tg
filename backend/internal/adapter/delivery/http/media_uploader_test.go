package http

import (
	"bytes"
	"context"
	"io"
	"testing"
)

type fakeUpSvc struct {
	id, owner    int64
	index, total int
	body         []byte
	size         int64
}

func (f *fakeUpSvc) SavePart(_ context.Context, id, ownerID int64, index, total int, r io.Reader, size int64) error {
	f.id, f.owner, f.index, f.total, f.size = id, ownerID, index, total, size
	f.body, _ = io.ReadAll(r)
	return nil
}

func TestMediaUploaderSavePart(t *testing.T) {
	svc := &fakeUpSvc{}
	up := NewMediaUploader(svc)
	if err := up.SavePart(context.Background(), 7, 42, 2, 10, []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	if svc.id != 42 || svc.owner != 7 || svc.index != 2 || svc.total != 10 || svc.size != 3 || !bytes.Equal(svc.body, []byte{1, 2, 3}) {
		t.Fatalf("proxy mismatch: %+v", svc)
	}
}
