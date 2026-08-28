package domain

import "sort"

// Проводной слой стикеров: строки таблиц → конструкторы схемы.
//
// Живёт в домене, а не в delivery, по той же причине, что `messagewire.go`:
// одна и та же карточка стикера уезжает девятью ручками, и «каждая собирает
// сама» — это девять форм одного предмета. Здесь она одна.
//
// Ключевое: стикер собирается ТЕМ ЖЕ `BuildDocument`, что и вложение
// сообщения. Пока витрина строила свою карточку, у неё разъезжались с
// сообщением ступени превью и атрибуты — стикер в чате и стикер в панели
// оказывались разными объектами.

// StickerDocument — стикер как `Document` схемы.
//
// `Position` строки сюда не попадает: порядок внутри набора задаёт позиция в
// векторе `documents` (Р8), и это ЕДИНСТВЕННОЕ его выражение — иначе появился
// бы второй источник, как было у `is_end` диалогов.
func StickerDocument(s Sticker) *Document {
	return BuildDocument(MediaSource{
		MediaID:      s.MediaID,
		Width:        s.Width,
		Height:       s.Height,
		Mime:         s.Mime,
		Size:         s.Size,
		Blur:         s.Thumb,
		PathThumb:    s.PathThumb,
		StickerAlt:   s.Emoji,
		StickerSetID: s.SetID,
		Kind:         "sticker",
	})
}

// StickerDocuments — вектор документов в порядке переданных строк.
func StickerDocuments(sts []Sticker) []*Document {
	out := make([]*Document, 0, len(sts))
	for _, s := range sts {
		out = append(out, StickerDocument(s))
	}
	return out
}

// GifDocument — сохранённый GIF как `Document` схемы.
//
// Тот же `BuildDocument`, что у стикера и у вложения сообщения: вид файла
// решают АТРИБУТЫ (`documentAttributeVideo` + `documentAttributeAnimated`),
// а не поле рядом. Длительности у строки нет — её и не требуется: гифка
// проигрывается циклом, а `duration` у оригинала здесь тоже нулевой.
func GifDocument(g SavedGif) *Document {
	return BuildDocument(MediaSource{
		MediaID:  g.MediaID,
		Width:    g.Width,
		Height:   g.Height,
		Mime:     g.Mime,
		Size:     g.Size,
		Blur:     g.Blur,
		Animated: g.Animated,
		Kind:     "gif",
	})
}

// GifDocuments — вектор GIF в порядке переданных строк (LIFO по saved_at).
func GifDocuments(gifs []SavedGif) []*Document {
	out := make([]*Document, 0, len(gifs))
	for _, g := range gifs {
		out = append(out, GifDocument(g))
	}
	return out
}

// RecentDocuments — недавние: документы и параллельный им вектор времён.
//
// Возвращаются вместе именно потому, что параллельны: собери их два вызова —
// и первая же перестановка одного из них разъехалась бы молча.
func RecentDocuments(rs []RecentSticker) ([]*Document, []int64) {
	docs := make([]*Document, 0, len(rs))
	dates := make([]int64, 0, len(rs))
	for _, r := range rs {
		docs = append(docs, StickerDocument(r.Sticker))
		dates = append(dates, r.UsedAt.Unix())
	}
	return docs, dates
}

// StickerPacks — обратный индекс «эмодзи → документы» (Р6).
//
// У нас эмодзи хранится НА КАЖДОМ стикере ровно одно, поэтому строка индекса
// собирается группировкой. Порядок строк — по эмодзи, чтобы вывод был
// детерминированным: клиент по нему ничего не решает, но разъезжающийся между
// запросами порядок ломал бы любое сравнение ответов.
func StickerPacks(sts []Sticker) []StickerPack {
	byEmoji := map[string][]int64{}
	for _, s := range sts {
		if s.Emoji == "" {
			continue
		}
		byEmoji[s.Emoji] = append(byEmoji[s.Emoji], s.MediaID)
	}
	emojis := make([]string, 0, len(byEmoji))
	for e := range byEmoji {
		emojis = append(emojis, e)
	}
	sort.Strings(emojis)
	out := make([]StickerPack, 0, len(emojis))
	for _, e := range emojis {
		out = append(out, NewStickerPack(e, byEmoji[e]))
	}
	return out
}

// StickerSetWire — строка набора как конструктор `stickerSet`.
//
// `Rank` не переносится: позиция в трендах выражается ПОРЯДКОМ вектора
// `messages.featuredStickers.sets` (Р8). `Kind` не переносится: вид набора это
// флаг `pFlags.emojis` (Р4). «Установлен ли» — срок установки, а не факт
// попадания в ответ ручки (Р5).
func StickerSetWire(r StickerSetRecord) StickerSet {
	set := StickerSet{
		Underscore: StickerSetTag,
		ID:         r.ID,
		Title:      r.Title,
		ShortName:  r.Slug,
		Count:      r.StickerCount,
		// Обложка-ДОКУМЕНТ: один из стикеров набора назначен обложкой. Схема
		// различает её и обложку-КАРТИНКУ (`thumbs` — отдельный файл превью),
		// у нас есть только первая (Р9).
		ThumbDocumentID: r.CoverMediaID,
	}
	if r.Kind == StickerSetKindEmoji {
		set.PFlags = map[string]bool{"emojis": true}
	}
	if !r.InstalledAt.IsZero() {
		set.InstalledDate = r.InstalledAt.Unix()
	}
	return set
}

// StickerSetsWire — вектор наборов в порядке переданных строк.
func StickerSetsWire(rs []StickerSetRecord) []StickerSet {
	out := make([]StickerSet, 0, len(rs))
	for _, r := range rs {
		out = append(out, StickerSetWire(r))
	}
	return out
}
