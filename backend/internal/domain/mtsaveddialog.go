package domain

// «Избранное» в разрезе источников: строка списка и её контейнер.
//
// Витрина отдавала карту, где рядом со ссылкой на источник лежали ЕГО СНИМОК
// (заголовок и номер аватарки, подклеенные JOIN-ами) и ВЫЖИМКА последнего
// сообщения. Тот же снимок-вместо-ссылки, что убирался у диалогов, участников,
// «кто отреагировал», адресной книги и тем форума.

const (
	SavedDialogTag          = "savedDialog"
	MessagesSavedDialogsTag = "messages.savedDialogs"
)

// savedDialog#bd87cb6c flags:# pinned:flags.2?true peer:Peer top_message:int
// = SavedDialog;
//
// СТРОКА «Избранного»: ссылка на источник плюс ссылка на его последнее
// сохранённое сообщение — и больше ничего.
//
// Вида источника строкой (`kind: 'self'|'user'|'chat'`) здесь нет: у оригинала
// его отвечает КОНСТРУКТОР ключа (`peerUser`/`peerChannel`), а «мои заметки» —
// совпадение ключа с самим зрителем. Счётчика сообщений тоже нет: у оригинала
// такого параметра не бывает, а наш не читал никто.
//
// `pinned` мы не производим: закрепления внутри «Избранного» у нас нет.
type SavedDialogReal struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
	// TopMessage — последнее сохранённое сообщение источника, НОМЕРОМ.
	TopMessage int64 `json:"top_message"`
}

// NewSavedDialog — строка «Избранного».
func NewSavedDialog(peer Peer, topMessage int64) SavedDialogReal {
	return SavedDialogReal{Underscore: SavedDialogTag, Peer: peer, TopMessage: topMessage}
}

// messages.savedDialogs#f83ae221 dialogs:Vector<SavedDialog>
// messages:Vector<Message> chats:Vector<Chat> users:Vector<User>
// = messages.SavedDialogs;
//
// Контейнер: строки плюс объекты, на которые они ссылаются. Заголовок и
// аватарка источника живут в его карточке (`chats`/`users`), последнее
// сообщение — в `messages`; клиент собирает и имя, и превью сам.
type MessagesSavedDialogs struct {
	Underscore string        `json:"_"`
	Dialogs    []SavedDialog `json:"dialogs"`
	Messages   []MTMessage   `json:"messages"`
	Chats      []Chat        `json:"chats"`
	Users      []UserReal    `json:"users"`
}

// SavedDialog — объединение схемы `SavedDialog`. Второй его конструктор
// (`monoForumDialog`) относится к платным сообщениям каналов, которых у нас
// нет вовсе.
type SavedDialog interface {
	isSavedDialog()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

func (SavedDialogReal) isSavedDialog() {}
func (d SavedDialogReal) Tag() string  { return d.Underscore }

// NewMessagesSavedDialogs — «Избранное» контейнером. Набор отдаётся ЦЕЛИКОМ,
// поэтому конструктор без `count` (у слайса он есть — messages.savedDialogsSlice).
func NewMessagesSavedDialogs(dialogs []SavedDialog, messages []MTMessage, chats []Chat, users []UserReal) MessagesSavedDialogs {
	return MessagesSavedDialogs{
		Underscore: MessagesSavedDialogsTag,
		Dialogs:    orEmpty(dialogs),
		Messages:   orEmpty(messages),
		Chats:      orEmpty(chats),
		Users:      orEmpty(users),
	}
}
