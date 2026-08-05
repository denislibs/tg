package http

import (
	"context"
	"io"

	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// FileStreamer отдаёт куски медиа по DNP-каналу (реализует ws.FileDispatcher).
// Проверка прав — тем же MediaAccess, что и HTTP-эндпоинт /media/{id}/content;
// байты — тем же media.Interactor.GetContent (Seek по offset). Native-HTTP путь
// не трогается, это его канальный дублёр.
type FileStreamer struct {
	access MediaAccess
	svc    *usecasemedia.Interactor
}

func NewFileStreamer(access MediaAccess, svc *usecasemedia.Interactor) *FileStreamer {
	return &FileStreamer{access: access, svc: svc}
}

// maxFileChunk — серверный потолок на чанк (клиент шлёт 512КБ; короткий ответ
// клиент дотянет следующим запросом).
const maxFileChunk = 1 << 20 // 1 MiB

// ReadPart проверяет доступ, открывает объект, сикает на offset и читает до limit
// байт. Возвращает (data, total=полный размер, err). Нет доступа → domain.ErrForbidden.
func (s *FileStreamer) ReadPart(ctx context.Context, userID, mediaID, offset, limit int64) ([]byte, int64, error) {
	// Клиент управляет offset/limit — не доверяем им напрямую: отрицательные
	// значения ведут к панике в make(), а завышенный limit — к аллокации
	// целого объекта (до 16 одновременных запросов при fileMaxConcurrent).
	if limit <= 0 || offset < 0 {
		return nil, 0, domain.ErrInvalid
	}

	allowed, err := s.access.CanAccessMedia(ctx, userID, mediaID)
	if err != nil {
		return nil, 0, err
	}
	if !allowed {
		return nil, 0, domain.ErrForbidden
	}
	rc, info, _, err := s.svc.GetContent(ctx, mediaID)
	if err != nil {
		return nil, 0, err
	}
	defer rc.Close()

	if offset > 0 {
		if _, err := rc.Seek(offset, io.SeekStart); err != nil {
			return nil, 0, err
		}
	}
	if limit > maxFileChunk {
		limit = maxFileChunk
	}
	remaining := info.Size - offset
	if remaining < 0 {
		remaining = 0
	}
	if limit > remaining {
		limit = remaining
	}
	buf := make([]byte, limit)
	n, err := io.ReadFull(rc, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return nil, 0, err
	}
	return buf[:n], info.Size, nil
}
