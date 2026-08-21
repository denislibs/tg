package chat

import "github.com/messenger-denis/backend/internal/domain"

// buildMedia собирает вложение сообщения в форме оригинала (MTProto) из строки
// media и типа сообщения. Единственное место, где принимается решение «фото или
// документ» и «какими атрибутами описан документ»: дальше по коду тип медиа
// выводится из самой модели (атрибуты + mime), как в appDocsManager, а не из
// подсказки витрины.
func buildMedia(m domain.Message, d MediaDims) domain.MessageMedia {
	var id int64
	if m.MediaID != nil {
		id = *m.MediaID
	}
	return domain.BuildMessageMedia(domain.MediaSource{
		MediaID:    id,
		Width:      d.Width,
		Height:     d.Height,
		Mime:       d.Mime,
		Blur:       d.Blur,
		HasThumb:   d.HasThumb,
		Duration:   d.Duration,
		Size:       d.Size,
		FileName:   d.FileName,
		Waveform:   d.Waveform,
		Title:      d.Title,
		Performer:  d.Performer,
		Animated:   d.Animated,
		PathThumb:  d.PathThumb,
		StickerAlt: d.StickerAlt,
		Spoiler:    m.MediaSpoiler,
		Kind:       m.Type,
	})
}
