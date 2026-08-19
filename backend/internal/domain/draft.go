package domain

import "time"

// Draft — облачный черновик сообщения (Telegram DraftMessage): по одному на
// пару (чат, пользователь), пустой текст без reply означает отсутствие
// черновика (удаление).
type Draft struct {
	ChatID    int64
	Text      string
	Entities  MessageEntities
	ReplyToID *int64
	UpdatedAt time.Time
}
