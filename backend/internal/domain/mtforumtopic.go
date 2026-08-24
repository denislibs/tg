package domain

// Темы форум-группы: строка списка и её контейнер.
//
// Витрина отдавала безымянную карту из двадцати ключей, где рядом со строкой
// темы лежали ВЫЖИМКИ последнего сообщения — `last_text`, `last_type`,
// `last_at` и склеенное сервером подзапросом `last_sender_name`. Это тот же
// снимок-вместо-ссылки, что уже убирался у диалогов: сообщение едет вектором
// `messages` контейнера, а тема адресует его числом `top_message`.

const (
	ForumTopicTag          = "forumTopic"
	MessagesForumTopicsTag = "messages.forumTopics"
)

// ForumTopic — объединение схемы `ForumTopic`. Второй его конструктор
// (`forumTopicDeleted`) мы не производим: удалённых тем витрина не отдаёт
// вовсе, а объявлять неиспользуемое — тот же мёртвый код.
type ForumTopic interface {
	isForumTopic()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// forumTopic#fcdad815 flags:# my:flags.1?true closed:flags.2?true
// pinned:flags.3?true short:flags.5?true hidden:flags.6?true
// title_missing:flags.7?true id:int date:int peer:Peer title:string
// icon_color:int icon_emoji_id:flags.0?long top_message:int
// read_inbox_max_id:int read_outbox_max_id:int unread_count:int
// unread_mentions_count:int unread_reactions_count:int
// unread_poll_votes_count:int from_id:Peer notify_settings:PeerNotifySettings
// draft:flags.4?DraftMessage = ForumTopic;
//
// СТРОКА списка тем в форме оригинала: состояние чтения, место в списке и
// ссылка на последнее сообщение. Ни текста превью, ни имени его автора, ни
// времени здесь нет по схеме — всё это выводится из самого сообщения.
//
// Что НАШЕ и объявлено клиентским параметром (schema_additional_params.json):
//
//   - `root_msg_id` — номер корневого сообщения темы. У оригинала он не нужен:
//     там id темы И ЕСТЬ номер её корня, а у нас это разные величины — ключ
//     строки и номер в чате. Сведение их — отдельная работа (задача);
//   - `icon_emoji_emoticon` — иконка темы. У схемы это `icon_emoji_id:long`,
//     то есть номер документа кастомного эмодзи; у нас — сам символ. Тот же
//     приём, что у `user.emoji_status_emoticon` оригинала;
//   - `pFlags.is_general` — системная тема «General». У оригинала её узнают по
//     id == 1, а наш id это ключ строки, поэтому признак едет явно.
//
// `pos` (порядок среди закреплённых) на провод не идёт: порядок задаёт сам
// вектор, и держать его вторым способом значило бы завести два источника.
type ForumTopicReal struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int64           `json:"id"`
	Date       int             `json:"date"`
	Peer       Peer            `json:"peer"`
	Title      string          `json:"title"`
	IconColor  int             `json:"icon_color"`
	// IconEmojiEmoticon — наш клиентский параметр (см. докблок).
	IconEmojiEmoticon string `json:"icon_emoji_emoticon,omitempty"`
	// RootMsgID — наш клиентский параметр (см. докблок). 0 у «General».
	RootMsgID int64 `json:"root_msg_id,omitempty"`
	// TopMessage — ПОСЛЕДНЕЕ сообщение темы, адресованное числом.
	TopMessage int64 `json:"top_message"`
	// ReadInboxMaxID — горизонт чтения зрителя в этой теме.
	ReadInboxMaxID int64 `json:"read_inbox_max_id"`
	// ReadOutboxMaxID — горизонт другой стороны. Пер-темного горизонта чужой
	// стороны мы не ведём, поэтому здесь всегда 0; параметр обязателен по
	// схеме и потому едет нулём, а не пропадает.
	ReadOutboxMaxID      int64 `json:"read_outbox_max_id"`
	UnreadCount          int   `json:"unread_count"`
	UnreadMentionsCount  int   `json:"unread_mentions_count"`
	UnreadReactionsCount int   `json:"unread_reactions_count"`
	// FromID — автор темы.
	FromID Peer `json:"from_id"`
	// NotifySettings — обязателен по схеме: «настроек нет» выражается пустым
	// конструктором, а не отсутствием поля. Заглушённость это СРОК, а не
	// булево поле рядом — тот же предикат, что у диалога.
	NotifySettings PeerNotifySettings `json:"notify_settings"`
}

func (ForumTopicReal) isForumTopic() {}
func (t ForumTopicReal) Tag() string { return t.Underscore }

// ForumTopicFlags — булевы флаги строки темы. «Выключено» это ОТСУТСТВИЕ
// ключа, поэтому передаются они структурой, а не набором аргументов.
type ForumTopicFlags struct {
	// My — тему создал зритель.
	My        bool
	Closed    bool
	Pinned    bool
	Hidden    bool
	IsGeneral bool
}

// NewForumTopic собирает строку списка тем.
func NewForumTopic(t ForumTopicRecord, peer, from Peer, topMessage, readInboxMaxID int64,
	unread, unreadMentions int, notify PeerNotifySettings, flags ForumTopicFlags) ForumTopicReal {
	out := ForumTopicReal{
		Underscore:          ForumTopicTag,
		ID:                  t.ID,
		Date:                unixSeconds(t.CreatedAt),
		Peer:                peer,
		Title:               t.Title,
		IconColor:           t.IconColor,
		IconEmojiEmoticon:   t.IconEmoji,
		RootMsgID:           t.RootMsgSeq,
		TopMessage:          topMessage,
		ReadInboxMaxID:      readInboxMaxID,
		UnreadCount:         unread,
		UnreadMentionsCount: unreadMentions,
		FromID:              from,
		NotifySettings:      notify,
	}
	setPFlag(&out.PFlags, "my", flags.My)
	setPFlag(&out.PFlags, "closed", flags.Closed)
	setPFlag(&out.PFlags, "pinned", flags.Pinned)
	setPFlag(&out.PFlags, "hidden", flags.Hidden)
	setPFlag(&out.PFlags, "is_general", flags.IsGeneral)
	return out
}

// messages.forumTopics#367617d3 flags:# order_by_create_date:flags.0?true
// count:int topics:Vector<ForumTopic> messages:Vector<Message>
// chats:Vector<Chat> users:Vector<User> pts:int = messages.ForumTopics;
//
// Контейнер списка тем: строки плюс объекты, на которые они ссылаются.
// Последние сообщения тем едут вектором `messages`, их авторы — вектором
// `users`; сервер больше не склеивает ни превью, ни имя автора.
//
// `pts` — курсор журнала апдейтов чата; он есть (UpdateRecord.Pts), но живёт
// не в теме, и витрина списка его не спрашивает — едет нулём.
type MessagesForumTopics struct {
	Underscore string       `json:"_"`
	Count      int          `json:"count"`
	Topics     []ForumTopic `json:"topics"`
	Messages   []MTMessage  `json:"messages"`
	Chats      []Chat       `json:"chats"`
	Users      []UserReal   `json:"users"`
	Pts        int          `json:"pts"`
}

// NewMessagesForumTopics — список тем контейнером. `count` это размер ПОЛНОГО
// набора; страницами темы у нас не отдаются, поэтому он и есть длина вектора.
func NewMessagesForumTopics(topics []ForumTopic, messages []MTMessage, chats []Chat, users []UserReal) MessagesForumTopics {
	return MessagesForumTopics{
		Underscore: MessagesForumTopicsTag,
		Count:      len(topics),
		Topics:     orEmpty(topics),
		Messages:   orEmpty(messages),
		Chats:      orEmpty(chats),
		Users:      orEmpty(users),
	}
}
