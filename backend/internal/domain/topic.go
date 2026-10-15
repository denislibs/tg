package domain

import (
	"errors"
	"time"
)

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

// ErrTopicIDInvalid — отправка в форуме с номером треда, который не тема (и не
// комментарии к посту канала): ошибка TG TOPIC_ID_INVALID у
// messages.sendMessage. tweb её не разбирает — у клиента это общая ошибка
// отправки.
var ErrTopicIDInvalid = errors.New("TOPIC_ID_INVALID")

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

// TopicScope — тема форума глазами выборок хранилища: сужает чтение
// упоминаний и реакций (messages.readMentions/readReactions{top_msg_id}).
// nil вместо указателя — весь чат.
type TopicScope struct {
	// General — тема General (номер 1): корня у неё нет, её сообщения — всё,
	// что не в темах (страж GeneralThreadRoot).
	General bool
	// RootID — внутренний ключ строки корня обычной темы (ByRoot).
	RootID int64
}

// ThreadRoot — ключ корня для threadFilter хранилища; nil — весь чат.
func (s *TopicScope) ThreadRoot() *int64 {
	if s == nil {
		return nil
	}
	root := s.RootID
	if s.General {
		root = GeneralThreadRoot
	}
	return &root
}

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

// TopicMine — тема «моя» (forumTopic.pFlags.my): её создал зритель. У General
// автора нет — её заводит сервер при включении тем, — и «моей» она не бывает
// ни у кого: управляет ею только право manage_topics (tweb canManageTopic,
// dialogs.ts:2263-2283; скрыть General — dialogsContextMenu.ts:396-401).
func TopicMine(t ForumTopicRecord, viewerID int64) bool {
	return !t.IsGeneral && t.CreatedBy == viewerID
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
	// MuteUntil — настройка уведомлений темы этим пользователем
	// (topic_user_state.muted_until), ТРИ состояния: nil — тему не трогал,
	// действует мьют чата; time.Unix(0) — явно «уведомлять»; срок — заглушена
	// до него (tweb appNotificationsManager.ts:398-405 наследует только при
	// mute_until === undefined).
	MuteUntil *time.Time
	// Draft — черновик зрителя в этой теме (forumTopic.draft); nil — нет.
	Draft *Draft
}

// TopicNotifySettings — настройки уведомлений темы для провода (строка списка
// и кадр мьюта). Три состояния, как у tweb (appNotificationsManager.ts:
// 398-405): nil — пустой peerNotifySettings без mute_until (тема наследует
// мьют чата, так же tweb рисует свежую тему, appMessagesManager.ts:10208);
// срок в прошлом или явное «уведомлять» — MuteUntilNever (истёкший срок,
// как у диалога, отдаётся нулём — notifyscan.go); иначе — срок.
func TopicNotifySettings(until *time.Time, now time.Time) PeerNotifySettings {
	s := PeerNotifySettings{Underscore: PeerNotifySettingsTag}
	if until == nil {
		return s
	}
	v := MuteUntilNever
	if until.After(now) {
		v = unixSeconds(*until)
	}
	s.MuteUntil = &v
	return s
}

// TopicMuted — заглушена ли тема В ЭТОТ МОМЕНТ с учётом наследования: своя
// настройка темы решает сама (tweb isPeerLocalMuted с threadId,
// respectType: false — тип чата не смотрится), иначе — chatMuted (мьют чата
// или типа чата, appNotificationsManager.ts:398-409).
func TopicMuted(topicUntil *time.Time, chatMuted bool, now time.Time) bool {
	if topicUntil != nil {
		return topicUntil.After(now)
	}
	return chatMuted
}

// ThreadReadState — состояние треда глазами зрителя для messageReplies поста
// (max_id/read_max_id, tweb replies.ts:110-118): MaxID — последний видимый
// номер треда, ReadMaxID — горизонт треда зрителя (max(запись треда,
// горизонт группы) — то же правило, что ThreadHorizon). 0 — нет.
type ThreadReadState struct {
	MaxID, ReadMaxID int64
}
