package domain

import "time"

// StickerSet — набор стикеров или анимированных эмодзи (Kind 'sticker'|'emoji').
// Наборы публичны: контент любого набора может смотреть и слать каждый;
// CreatedBy нужен только для права пополнять набор и наружу не отдаётся.
type StickerSet struct {
	ID           int64  `json:"id"`
	Slug         string `json:"slug"`
	Title        string `json:"title"`
	Kind         string `json:"kind"`
	StickerCount int    `json:"count"`
	CreatedBy    int64  `json:"-"`
	// Rank — позиция набора в трендах Telegram (0 — вне трендов, такие идут
	// последними). Панель стикеров показывает наборы именно в этом порядке.
	Rank int `json:"rank"`
	// CoverMediaID — обложка набора (иконка вкладки, tweb stickerSetThumb);
	// 0 — обложки нет, клиент рисует первый стикер набора.
	CoverMediaID int64 `json:"cover_media_id,omitempty"`
}

// Sticker — один стикер набора; файл лежит в media (клиент строит URL по
// media_id), Emoji — привязанное эмодзи для поиска/подсказок.
//
// Width/Height/Mime/Thumb — зеркало полей media, снятое джойном: клиенту они
// нужны ДО загрузки самого файла. По ним он вписывает стикер в бокс по пропорции
// (tweb `makeMediaSize(doc.w, doc.h).aspectFitted`), заранее знает, чем рисовать
// (lottie/webp/webm), и показывает нижний слой превью, пока файл летит.
type Sticker struct {
	ID       int64  `json:"id"`
	SetID    int64  `json:"set_id"`
	MediaID  int64  `json:"media_id"`
	Emoji    string `json:"emoji"`
	Position int    `json:"position"`
	// Width/Height — 0, если размеры не известны (медиа загружено до появления
	// процессинга, либо ffprobe/lottie-разбор ничего не дали); клиент в этом
	// случае падает на квадратный бокс.
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Mime   string `json:"mime"`
	// Thumb — stripped-превью из media.blur_preview (крошечный JPEG, см.
	// domain.Media.BlurPreview). nil у lottie (на бэке не растеризуем — первый
	// кадр клиент кэширует сам) и у медиа без сгенерированного превью.
	Thumb []byte `json:"thumb,omitempty"`
}

// SavedGif — сохранённый пользователем GIF (вкладка GIF в панели стикеров).
type SavedGif struct {
	MediaID int64     `json:"media_id"`
	SavedAt time.Time `json:"saved_at"`
}
