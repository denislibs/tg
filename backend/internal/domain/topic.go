package domain

import "time"

// ForumTopic — тема форум-группы (Telegram forum topic). Сообщения темы —
// тред: thread_root_id = RootMsgID (сервисное сообщение о создании темы).
type ForumTopic struct {
	ID         int64
	ChatID     int64
	RootMsgID  int64
	Title      string
	IconColor  int // индекс цвета значка (палитра tweb)
	Closed     bool
	CreatedBy  int64
	CreatedAt  time.Time
}

// TopicRow — строка списка тем: тема + последнее сообщение + счётчик.
type TopicRow struct {
	Topic          ForumTopic
	MsgCount       int
	LastText       string
	LastType       string
	LastSenderName string
	LastAt         *time.Time
}
