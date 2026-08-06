package http

import (
	"bytes"
	"context"
	"testing"
)

type fakeChunkWriter struct {
	owner, mediaID, offset, total int64
	body                          []byte
	done                          bool
	err                           error
}

func (f *fakeChunkWriter) WriteChunk(_ context.Context, ownerID, mediaID, offset, total int64, data []byte) (bool, error) {
	f.owner, f.mediaID, f.offset, f.total = ownerID, mediaID, offset, total
	f.body = append([]byte(nil), data...)
	return f.done, f.err
}

func TestMediaUploaderWriteChunk(t *testing.T) {
	su := &fakeChunkWriter{done: true}
	up := NewMediaUploader(su)
	done, err := up.WriteChunk(context.Background(), 7, 42, 3, 10, []byte{1, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	if !done {
		t.Fatal("expected done=true to be propagated")
	}
	if su.owner != 7 || su.mediaID != 42 || su.offset != 3 || su.total != 10 || !bytes.Equal(su.body, []byte{1, 2, 3}) {
		t.Fatalf("proxy mismatch: %+v", su)
	}
}
