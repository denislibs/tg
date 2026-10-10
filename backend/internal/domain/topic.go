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
	// RootMsgSeq — тот же корень НОМЕРОМ в чате. Наружу тема адресуется
	// Number(), а не этим полем: у General корневого сообщения нет (0).
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

// GeneralTopicID — номер темы «General» снаружи. Порт tweb
// lib/appManagers/constants.ts:26 (`GENERAL_TOPIC_ID = MESSAGE_ID_OFFSET + 1`,
// серверный номер 1): у General нет служебки создания, и TG адресует её
// псевдонимом 1 — номером, который в канале занят служебкой создания самого
// чата (getReplies(1) у форума отдаёт General, appMessagesManager.ts:13414-13420).
const GeneralTopicID int64 = 1

// GeneralThreadRoot — «ключ корня» General для выборок хранилища. Строки корня
// у General нет (thread_root_id её сообщений — NULL), поэтому выборка треда
// узнаёт её по этому стражу: реальные ключи строк положительны, 0 занят
// стражем «треда нет» (resolveThreadRootForQuery).
const GeneralThreadRoot int64 = -1

// Number — номер темы снаружи (forumTopic.id, topic_id ручек, top_msg_id
// кадров): номер служебки messageActionTopicCreate в чате, у General — 1.
// Внутренний ID строки forum_topics наружу не выходит (tweb
// appMessagesManager.ts:10100-10101: id темы = id сообщения создания).
func (t ForumTopicRecord) Number() int64 {
	if t.IsGeneral {
		return GeneralTopicID
	}
	return t.RootMsgSeq
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
	// ReadOutboxSeq — горизонт ОСТАЛЬНЫХ в этой теме (read_outbox_max_id):
	// максимум их last_read_seq — то же правило «✓✓ группы — MAX», что у чата.
	ReadOutboxSeq int64
	// UnreadCount — непрочитанные сообщения темы (чужие, seq > LastReadSeq).
	UnreadCount int
	// UnreadMentions — непрочитанные упоминания зрителя в этой теме.
	UnreadMentions int
	// UnreadReactions — сообщения зрителя в теме с непрочитанной реакцией
	// (unread_reactions_count; тот же предикат, что у чата, миграция 0160).
	UnreadReactions int
	// MuteUntil — срок мьюта темы этим пользователем (topic_user_state.muted_until);
	// nil — переопределения нет.
	MuteUntil *time.Time
}

// TopicNotifySettings — настройки уведомлений темы для провода (строка списка
// и кадр мьюта): мьют — СРОК, тот же предикат, что у диалога. Срок в прошлом
// и отсутствие срока — явный MuteUntilNever: «замьючена ли» тема отвечает
// сама строка, переопределение ей не нужно.
func TopicNotifySettings(until *time.Time, now time.Time) PeerNotifySettings {
	v := MuteUntilNever
	if until != nil && until.After(now) {
		v = unixSeconds(*until)
	}
	return PeerNotifySettings{Underscore: PeerNotifySettingsTag, MuteUntil: &v}
}
