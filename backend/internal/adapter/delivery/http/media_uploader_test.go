package http

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
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

// TestMediaUploaderWriteChunkTranslatesForbidden ловит регрессию: usecase
// возвращает СВОЙ сентинел usecasemedia.ErrForbidden (не тот же объект, что
// domain.ErrForbidden), а dispatchFileUp в ws-слое матчит именно
// domain.ErrForbidden через errors.Is. Без трансляции на границе адаптера
// «чужой mediaID» маппился бы в общий "error" вместо "forbidden".
func TestMediaUploaderWriteChunkTranslatesForbidden(t *testing.T) {
	su := &fakeChunkWriter{err: usecasemedia.ErrForbidden}
	up := NewMediaUploader(su)
	_, err := up.WriteChunk(context.Background(), 7, 42, 0, 10, []byte{1})
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("expected domain.ErrForbidden, got %v", err)
	}
}
