package domain

// Счётчики поста канала и списки чатов.
//
// Просмотры и комментарии ехали ДВУМЯ безымянными картами, ключом которых был
// номер поста в виде строки (`{"counts": {"5": 2}}`). У оригинала это ОДИН
// конструктор: `messageViews{views, forwards, replies}` — просмотры, репосты и
// тред одного поста лежат вместе, потому что это счётчики одного предмета.

const (
	MessageViewsTag         = "messageViews"
	MessagesMessageViewsTag = "messages.messageViews"
	MessagesChatsTag        = "messages.chats"
	MessagesChatsSliceTag   = "messages.chatsSlice"
)

// messageViews#455b853d flags:# views:flags.0?int forwards:flags.1?int
// replies:flags.2?MessageReplies = MessageViews;
//
// Счётчики ОДНОГО поста. Все три параметра необязательны: отсутствие ключа
// значит «этой величины нет», а не ноль — у поста без комментариев треда не
// существует вовсе, и `replies: 0` соврал бы о его наличии.
//
// `forwards` мы не считаем: пересылок поста наружу не учитываем нигде.
type MessageViews struct {
	Underscore string          `json:"_"`
	Views      *int64          `json:"views,omitempty"`
	Replies    *MessageReplies `json:"replies,omitempty"`
}

// NewMessageViewsCount — счётчик просмотров поста.
func NewMessageViewsCount(views int64) MessageViews {
	return MessageViews{Underscore: MessageViewsTag, Views: &views}
}

// NewMessageViewsReplies — тред поста (счётчик комментариев и их авторы).
func NewMessageViewsReplies(replies MessageReplies) MessageViews {
	return MessageViews{Underscore: MessageViewsTag, Replies: &replies}
}

// NewMessageViewsEmpty — «про этот пост сказать нечего»: конструктор без
// единого параметра. Так выражается пробел ПОЗИЦИОННОГО вектора: у оригинала
// ответ идёт в том же порядке, в каком спрашивали, и выпадение элемента
// сдвинуло бы все остальные.
func NewMessageViewsEmpty() MessageViews {
	return MessageViews{Underscore: MessageViewsTag}
}

// messages.messageViews#b6c4f543 views:Vector<MessageViews> chats:Vector<Chat>
// users:Vector<User> = messages.MessageViews;
//
// Вектор `views` ПОЗИЦИОННЫЙ: i-й элемент отвечает i-му номеру из запроса.
// Прежде ответ был картой, ключом которой служил номер поста строкой, — форма,
// которую на проводе TL записать нечем.
//
// `users` — карточки авторов последних комментариев: тред несёт на них
// ССЫЛКИ, а карточки едут один раз рядом.
type MessagesMessageViews struct {
	Underscore string         `json:"_"`
	Views      []MessageViews `json:"views"`
	Chats      []Chat         `json:"chats"`
	Users      []UserReal     `json:"users"`
}

// NewMessagesMessageViews — счётчики пачки постов.
func NewMessagesMessageViews(views []MessageViews, users []UserReal) MessagesMessageViews {
	return MessagesMessageViews{
		Underscore: MessagesMessageViewsTag,
		Views:      orEmpty(views),
		Chats:      []Chat{},
		Users:      orEmpty(users),
	}
}

// ── messages.Chats: просто список чатов ────────────────────────────────────

// MessagesChats — объединение `messages.Chats`: набор отдан целиком либо
// куском.
type MessagesChats interface {
	isMessagesChats()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// messages.chats#64ff9fd5 chats:Vector<Chat> = messages.Chats;
type MessagesChatsReal struct {
	Underscore string `json:"_"`
	Chats      []Chat `json:"chats"`
}

func (MessagesChatsReal) isMessagesChats() {}
func (c MessagesChatsReal) Tag() string    { return c.Underscore }

// NewMessagesChats — набор отдан ЦЕЛИКОМ: параметра count у конструктора нет,
// он и есть длина вектора.
func NewMessagesChats(chats []Chat) MessagesChatsReal {
	return MessagesChatsReal{Underscore: MessagesChatsTag, Chats: orEmpty(chats)}
}

// messages.chatsSlice#9cd81144 count:int chats:Vector<Chat> = messages.Chats;
type MessagesChatsSlice struct {
	Underscore string `json:"_"`
	Count      int    `json:"count"`
	Chats      []Chat `json:"chats"`
}

func (MessagesChatsSlice) isMessagesChats() {}
func (c MessagesChatsSlice) Tag() string    { return c.Underscore }

// NewMessagesChatsSlice — отдан кусок; count считается по ПОЛНОМУ набору.
func NewMessagesChatsSlice(count int, chats []Chat) MessagesChatsSlice {
	return MessagesChatsSlice{Underscore: MessagesChatsSliceTag, Count: count, Chats: orEmpty(chats)}
}
