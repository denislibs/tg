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
// `id` — НОМЕР темы: номер служебки messageActionTopicCreate в чате, у General
// — 1 (ForumTopicRecord.Number, tweb dialogs.ts:2219 и constants.ts:26).
// Отдельных `root_msg_id` и `pFlags.is_general` больше нет: у оригинала id
// темы И ЕСТЬ номер её корня, а General узнаётся по id == 1.
//
// Наш клиентский параметр (schema_additional_params.json) один —
// `icon_emoji_emoticon`, иконка темы: у схемы это `icon_emoji_id:long`, номер
// документа кастомного эмодзи, у нас — сам символ. Тот же приём, что у
// `user.emoji_status_emoticon` оригинала.
//
// Не производятся: `unread_poll_votes_count` (голосов опроса как
// непрочитанного у нас нет — пропуск назван в OmittedWithoutSubject) и `draft`
// (черновики тредов — волна 2, БЭК-2).
//
// `pos` (порядок среди закреплённых) на провод не идёт: порядок задаёт сам
// вектор, и держать его вторым способом значило бы завести два источника.
type ForumTopicReal struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// ID — номер темы (см. докблок).
	ID        int64  `json:"id"`
	Date      int    `json:"date"`
	Peer      Peer   `json:"peer"`
	Title     string `json:"title"`
	IconColor int    `json:"icon_color"`
	// IconEmojiEmoticon — наш клиентский параметр (см. докблок).
	IconEmojiEmoticon string `json:"icon_emoji_emoticon,omitempty"`
	// TopMessage — ПОСЛЕДНЕЕ сообщение темы, адресованное числом.
	TopMessage int64 `json:"top_message"`
	// ReadInboxMaxID — горизонт чтения зрителя в этой теме.
	ReadInboxMaxID int64 `json:"read_inbox_max_id"`
	// ReadOutboxMaxID — горизонт остальных: ✓✓ своих сообщений в теме (tweb
	// dialogs.ts:1635, 1745-1746).
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
	My     bool
	Closed bool
	Pinned bool
	Hidden bool
}

// ForumTopicState — состояние темы глазами зрителя: ссылка на последнее
// сообщение, горизонты и счётчики непрочитанного.
type ForumTopicState struct {
	TopMessage      int64
	ReadInboxMaxID  int64
	ReadOutboxMaxID int64
	Unread          int
	UnreadMentions  int
	UnreadReactions int
}

// NewForumTopic собирает строку списка тем.
func NewForumTopic(t ForumTopicRecord, peer, from Peer, st ForumTopicState,
	notify PeerNotifySettings, flags ForumTopicFlags) ForumTopicReal {
	out := ForumTopicReal{
		Underscore:           ForumTopicTag,
		ID:                   t.Number(),
		Date:                 unixSeconds(t.CreatedAt),
		Peer:                 peer,
		Title:                t.Title,
		IconColor:            t.IconColor,
		IconEmojiEmoticon:    t.IconEmoji,
		TopMessage:           st.TopMessage,
		ReadInboxMaxID:       st.ReadInboxMaxID,
		ReadOutboxMaxID:      st.ReadOutboxMaxID,
		UnreadCount:          st.Unread,
		UnreadMentionsCount:  st.UnreadMentions,
		UnreadReactionsCount: st.UnreadReactions,
		FromID:               from,
		NotifySettings:       notify,
	}
	setPFlag(&out.PFlags, "my", flags.My)
	setPFlag(&out.PFlags, "closed", flags.Closed)
	setPFlag(&out.PFlags, "pinned", flags.Pinned)
	setPFlag(&out.PFlags, "hidden", flags.Hidden)
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

// NotifyForumTopicTag — дискриминатор `_` конструктора notifyForumTopic.
const NotifyForumTopicTag = "notifyForumTopic"

// notifyForumTopic#226e6308 peer:Peer top_msg_id:int = NotifyPeer;
//
// Адрес настроек уведомлений ТЕМЫ: пир плюс номер темы (у General — 1). Мьют
// темы у оригинала — account.updateNotifySettings с inputNotifyForumTopic
// (tweb appMessagesManager.ts:11962-11981), и обратно он приезжает этим адресом.
type NotifyForumTopic struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
	TopMsgID   int64  `json:"top_msg_id"`
}

func (NotifyForumTopic) isNotifyPeer() {}

func NewNotifyForumTopic(peer Peer, topicID int64) NotifyForumTopic {
	return NotifyForumTopic{Underscore: NotifyForumTopicTag, Peer: peer, TopMsgID: topicID}
}
