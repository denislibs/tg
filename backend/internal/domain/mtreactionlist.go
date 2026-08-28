package domain

// Списки, связанные с реакциями, и «от чьего лица писать».
//
// Три витрины, у каждой из которых конструктор в схеме уже был, а ехала она
// безымянной картой: «кто отреагировал», «теги Избранного» и список личностей
// отправителя.

const (
	MessagesMessageReactionsListTag = "messages.messageReactionsList"
	SavedReactionTagTag             = "savedReactionTag"
	MessagesSavedReactionTagsTag    = "messages.savedReactionTags"
	SendAsPeerTag                   = "sendAsPeer"
	ChannelsSendAsPeersTag          = "channels.sendAsPeers"
)

// messages.messageReactionsList#31bd492d flags:# count:int
// reactions:Vector<MessagePeerReaction> chats:Vector<Chat> users:Vector<User>
// next_offset:flags.0?string = messages.MessageReactionsList;
//
// «Кто отреагировал»: строки — конструкторы `messagePeerReaction` (пир + дата +
// реакция), карточки — вектором `users`. Прежде витрина клеила карточку
// пользователя в каждую строку рядом со строкой-эмодзи.
type MessagesMessageReactionsList struct {
	Underscore string                `json:"_"`
	Count      int                   `json:"count"`
	Reactions  []MessagePeerReaction `json:"reactions"`
	Chats      []Chat                `json:"chats"`
	Users      []UserReal            `json:"users"`
}

func NewMessagesMessageReactionsList(reactions []MessagePeerReaction, users []UserReal) MessagesMessageReactionsList {
	return MessagesMessageReactionsList{
		Underscore: MessagesMessageReactionsListTag,
		Count:      len(reactions),
		Reactions:  orEmpty(reactions),
		Chats:      []Chat{},
		Users:      orEmpty(users),
	}
}

// savedReactionTag#cb6ff828 flags:# reaction:Reaction title:flags.0?string
// count:int = SavedReactionTag;
//
// Реакция здесь — ОБЪЕДИНЕНИЕ `Reaction`, а не строка эмодзи: тот же предмет,
// что в агрегате сообщения, и та же форма.
type SavedReactionTag struct {
	Underscore string   `json:"_"`
	Reaction   Reaction `json:"reaction"`
	Title      string   `json:"title,omitempty"`
	Count      int      `json:"count"`
}

// messages.savedReactionTags#3259950a tags:Vector<SavedReactionTag> hash:long
// = messages.SavedReactionTags;
//
// `hash` — хэш кэширования запроса; хэш-кэширования у нас нет вовсе
// (OmittedWithoutSubject, как у стикеров).
type MessagesSavedReactionTags struct {
	Underscore string             `json:"_"`
	Tags       []SavedReactionTag `json:"tags"`
}

func NewMessagesSavedReactionTags(tags []SavedTag) MessagesSavedReactionTags {
	out := make([]SavedReactionTag, 0, len(tags))
	for _, t := range tags {
		out = append(out, SavedReactionTag{
			Underscore: SavedReactionTagTag,
			Reaction:   NewReactionEmoji(t.Reaction),
			Title:      t.Title,
			Count:      t.Count,
		})
	}
	return MessagesSavedReactionTags{Underscore: MessagesSavedReactionTagsTag, Tags: out}
}

// sendAsPeer#b81c7034 flags:# premium_required:flags.0?true peer:Peer
// = SendAsPeer;
//
// Прежде и этот конструктор, и контейнер ниже собирались КАРТАМИ со строковым
// литералом в ключе `_`: форма была угадана верно, но держалась на аккуратности
// автора — сверка со схемой работает по типам и до карты не доходила.
type SendAsPeer struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
}

func NewSendAsPeer(p Peer) SendAsPeer { return SendAsPeer{Underscore: SendAsPeerTag, Peer: p} }

// channels.sendAsPeers#f496b0c6 peers:Vector<SendAsPeer> chats:Vector<Chat>
// users:Vector<User> = channels.SendAsPeers;
type ChannelsSendAsPeers struct {
	Underscore string       `json:"_"`
	Peers      []SendAsPeer `json:"peers"`
	Chats      []Chat       `json:"chats"`
	Users      []UserReal   `json:"users"`
}

func NewChannelsSendAsPeers(peers []SendAsPeer, chats []Chat, users []UserReal) ChannelsSendAsPeers {
	return ChannelsSendAsPeers{
		Underscore: ChannelsSendAsPeersTag,
		Peers:      orEmpty(peers),
		Chats:      orEmpty(chats),
		Users:      orEmpty(users),
	}
}
