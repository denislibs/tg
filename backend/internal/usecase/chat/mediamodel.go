package chat

import "github.com/messenger-denis/backend/internal/domain"

// buildMedia собирает вложение сообщения в форме оригинала (MTProto) из строки
// media и типа сообщения. Единственное место, где принимается решение «фото или
// документ» и «какими атрибутами описан документ»: дальше по коду тип медиа
// выводится из самой модели (атрибуты + mime), как в appDocsManager, а не из
// подсказки витрины.
// Метаданные файла приезжают уже в `domain.MediaSource` (порт DimsByIDs),
// поэтому переписывания поле-в-поле здесь больше нет: сообщение дописывает
// ровно то, чего файл о себе не знает, — свой номер, спойлер этого вложения и
// вид (`type` строки messages).
func buildMedia(m domain.Message, src domain.MediaSource) domain.MessageMedia {
	if m.MediaID != nil {
		src.MediaID = *m.MediaID
	}
	src.Spoiler = m.MediaSpoiler
	src.Kind = m.Type
	return domain.BuildMessageMedia(src)
}
