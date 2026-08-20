package domain

import "time"

// ForumTopic — тема форум-группы (Telegram forum topic). Сообщения темы —
// тред: thread_root_id = RootMsgID (сервисное сообщение о создании темы).
type ForumTopic struct {
	ID     int64
	ChatID int64
	// RootMsgID — ключ строки корневого сообщения (внутренний: по нему
	// связаны thread_root_id и topic_user_state).
	RootMsgID int64
	// RootMsgSeq — тот же корень НОМЕРОМ в чате: наружу тема адресует своё
	// корневое сообщение так же, как любое другое (пара «пир + номер»).
	// 0 — у системной темы «General» корневого сообщения нет вовсе.
	RootMsgSeq int64
	Title      string
	IconColor  int    // индекс цвета значка (палитра tweb)
	IconEmoji  string // unicode-emoji иконки; если задан — показывается вместо цвета
	Closed     bool
	Hidden     bool
	Pinned     bool
	Pos        int  // порядок среди закреплённых
	IsGeneral  bool // системная тема «General» — всегда первая, нельзя закрыть/удалить
	CreatedBy  int64
	CreatedAt  time.Time
}

// TopicRow — строка списка тем: тема + последнее сообщение + счётчики,
// как обычный dialog-ряд (Telegram forumTopic несёт unread/mute/read-state).
type TopicRow struct {
	Topic          ForumTopic
	MsgCount       int
	LastText       string
	LastType       string
	LastSenderName string
	LastAt         *time.Time
	// UnreadCount — непрочитанные сообщения темы (чужие, seq > last_read_seq).
	UnreadCount int
	// UnreadMentions — непрочитанные упоминания зрителя в этой теме.
	UnreadMentions int
	// Muted — тема заглушена этим пользователем (topic_user_state.muted).
	Muted bool
	// LastOut — последнее сообщение темы отправлено этим пользователем (для галочек).
	LastOut bool
	// LastMsgSeq — seq последнего сообщения темы (для пометки «прочитано»).
	LastMsgSeq int64
}
