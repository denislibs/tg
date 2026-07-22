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
}

// Sticker — один стикер набора; файл лежит в media (клиент строит URL по
// media_id), Emoji — привязанное эмодзи для поиска/подсказок.
type Sticker struct {
	ID       int64  `json:"id"`
	SetID    int64  `json:"set_id"`
	MediaID  int64  `json:"media_id"`
	Emoji    string `json:"emoji"`
	Position int    `json:"position"`
}

// SavedGif — сохранённый пользователем GIF (вкладка GIF в панели стикеров).
type SavedGif struct {
	MediaID int64     `json:"media_id"`
	SavedAt time.Time `json:"saved_at"`
}
