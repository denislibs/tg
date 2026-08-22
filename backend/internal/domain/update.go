package domain

import "encoding/json"

// UpdateRecord — СТРОКА журнала обновлений: курсор плюс замороженное тело
// кадра. Не путать с `Update` — объединением самих кадров (mtupdate.go): здесь
// хранимая запись со своим типом-строкой, там конструктор схемы.
//
// Имя с суффиксом Record — та же развязка, что у ChatRecord, DialogRecord и
// StickerSetRecord: строка хранилища против конструктора схемы.
type UpdateRecord struct {
	Pts      int64
	PtsCount int
	Type     string
	Payload  json.RawMessage
}

type UserState struct {
	Pts  int64 `json:"pts"`
	Date int64 `json:"date"`
}
