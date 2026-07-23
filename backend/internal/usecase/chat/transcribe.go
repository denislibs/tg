package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// transcriptionStub — детерминированный демо-текст расшифровки. Реального движка
// speech-to-text у нас нет, поэтому сервер отдаёт фиксированную строку и кэширует
// её на сообщении (messages.transcription), чтобы повторный запрос был мгновенным.
const transcriptionStub = "Расшифровка недоступна в демо-режиме"

// TranscribeMessage возвращает расшифровку голосового/видео-кружка (Telegram
// messages.transcribeAudio). Если расшифровка уже кэширована — отдаёт её; иначе
// генерирует детерминированный стаб и сохраняет. Доступно только участнику чата
// (domain.ErrForbidden) и только для голосовых/кружков (domain.ErrInvalid).
func (i *Interactor) TranscribeMessage(ctx context.Context, chatID, msgID, userID int64) (string, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", domain.ErrForbidden
	}
	m, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return "", err
	}
	if m.ChatID != chatID || m.Deleted {
		return "", domain.ErrNotFound
	}
	if m.Type != "voice" && m.Type != "roundVideo" {
		return "", domain.ErrInvalid
	}
	if m.Transcription != nil && *m.Transcription != "" {
		return *m.Transcription, nil
	}
	upd, err := i.msgs.SetTranscription(ctx, msgID, transcriptionStub)
	if err != nil {
		return "", err
	}
	if upd.Transcription != nil {
		return *upd.Transcription, nil
	}
	return transcriptionStub, nil
}
