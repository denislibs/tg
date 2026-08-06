package http

import (
	"context"
	"errors"

	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// chunkWriter — узкий порт usecase (тестируемость): совпадает с
// usecasemedia.StreamUploads.WriteChunk.
type chunkWriter interface {
	WriteChunk(ctx context.Context, ownerID, mediaID, offset, total int64, data []byte) (bool, error)
}

// MediaUploader реализует ws.UploadDispatcher: пишет offset-ordered чанк медиа
// из DNP-канала через usecase StreamUploads (права владельца — внутри usecase).
type MediaUploader struct{ su chunkWriter }

func NewMediaUploader(su chunkWriter) *MediaUploader { return &MediaUploader{su: su} }

// WriteChunk инвертирует порядок аргументов ws-контракта (userID, mediaID) в
// порядок usecase (ownerID=userID, mediaID) — права владельца проверяются
// внутри su. usecasemedia.ErrForbidden — отдельный сентинел (не тот же объект,
// что domain.ErrForbidden), а ws-слой (dispatchFileUp) матчит именно
// domain.ErrForbidden, чтобы не зависеть от usecase напрямую — транслируем
// здесь, на границе адаптера.
func (u *MediaUploader) WriteChunk(ctx context.Context, userID, mediaID, offset, total int64, data []byte) (bool, error) {
	done, err := u.su.WriteChunk(ctx, userID, mediaID, offset, total, data)
	if errors.Is(err, usecasemedia.ErrForbidden) {
		return done, domain.ErrForbidden
	}
	return done, err
}
