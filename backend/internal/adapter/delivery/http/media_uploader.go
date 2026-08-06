package http

import (
	"bytes"
	"context"
	"io"
)

// partSaver — узкий порт usecase (тестируемость): совпадает с
// usecasemedia.Interactor.SavePart.
type partSaver interface {
	SavePart(ctx context.Context, id, ownerID int64, partIndex, total int, r io.Reader, size int64) error
}

// MediaUploader реализует ws.UploadDispatcher: пишет part медиа из DNP-канала через
// usecase SavePart (права владельца — внутри usecase).
type MediaUploader struct{ svc partSaver }

func NewMediaUploader(svc partSaver) *MediaUploader { return &MediaUploader{svc: svc} }

// SavePart инвертирует порядок аргументов ws-контракта (userID, mediaID) в порядок
// usecase (id=mediaID, ownerID=userID) — права владельца проверяются внутри svc.
func (u *MediaUploader) SavePart(ctx context.Context, userID, mediaID int64, index, total int, data []byte) error {
	return u.svc.SavePart(ctx, mediaID, userID, index, total, bytes.NewReader(data), int64(len(data)))
}
