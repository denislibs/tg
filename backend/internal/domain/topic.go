package domain

import "time"

// ForumTopicRecord — тема форум-группы ВЫБОРКОЙ: наш набор колонок, а не объект
// провода. Имя схемы `forumTopic` занял конструктор (mtforumtopic.go) — тот же
// приём, что у UserRecord/ChatRecord/PrivacyRuleRecord.
//
// Сообщения темы — тред: thread_root_id = RootMsgID (сервисное сообщение о
// создании темы).
type ForumTopicRecord struct {
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

// TopicRow — строка списка тем: тема плюс состояние чтения зрителя, и ничего
// больше. Выжимок последнего сообщения (`last_text`, `last_type`,
// `last_sender_name`, `last_at`) здесь нет: само сообщение едет вектором
// `messages` контейнера и адресуется числом `top_message` — тот же ход, что
// сделан у диалогов.
type TopicRow struct {
	Topic ForumTopicRecord
	// LastMsgID — КЛЮЧ СТРОКИ последнего сообщения темы: по нему контейнер
	// достаёт само сообщение одним запросом на страницу.
	LastMsgID int64
	// LastMsgSeq — тот же последний НОМЕРОМ в чате (top_message конструктора).
	LastMsgSeq int64
	// LastReadSeq — горизонт чтения зрителя в этой теме (read_inbox_max_id).
	LastReadSeq int64
	// UnreadCount — непрочитанные сообщения темы (чужие, seq > LastReadSeq).
	UnreadCount int
	// UnreadMentions — непрочитанные упоминания зрителя в этой теме.
	UnreadMentions int
	// Muted — тема заглушена этим пользователем (topic_user_state.muted).
	Muted bool
}
