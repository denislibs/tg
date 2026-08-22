package domain

// Кадры реального времени в форме оригинала — конструкторы объединения
// `Update`, а не конверт `{t, d}` с типом СТРОКОЙ.
//
// Правила фазы 0 (дискриминатор `_`, pFlags вместо flags, «выключено» это
// отсутствие ключа, у каждого конструктора своя структура) — в шапке mtpeer.go.
// Разбор подсистемы и принятые решения — docs/readiness/tl-updates-analysis.md.
//
// ── Почему это вообще подсистема ────────────────────────────────────────────
// Наш кадр — конверт `{t: "new_message", d: {...}}`: вид кадра выражен строкой
// рядом с телом. Это седьмое место в программе, где вид сущности подделан
// значением поля вместо ВЫБОРА КОНСТРУКТОРА (были: тип сообщения, вид кнопки,
// вид чата, вид сущности, «конец списка», стикер как отдельный тип).
//
// В схеме кадр — конструктор объединения Update (их 160), тип выражен числовым
// id, а конверт существует только как контейнер пачки: updates{updates, users,
// chats, date, seq}.
//
// ── pts — ПАРАМЕТР конструктора, а не поле конверта (решение Р2) ────────────
// У нас курсор дописывается в тело на выходе (framePts/frameChannelPts), то
// есть живёт рядом с ним. В схеме это обычный параметр — и у части
// конструкторов его нет вовсе (updateUserTyping, updateUserStatus). То есть
// наше деление кадров на «логируемые» и «эфемерные» в схеме выражено
// СТРУКТУРОЙ, а не таблицей в отдельном файле.
//
// pts_count у нас отсутствовал: курсор плотный, каждый апдейт двигает его на
// единицу. Поэтому здесь он честная единица (PtsCountOne), а не выдумка
// клиента.
//
// Пер-канальный курсор — это `pts` у updateNewChannelMessage: в схеме
// канальные кадры несут СВОЙ pts, а отличаются от общих конструктором, а не
// именем ключа (`channel_pts`).
//
// ── Пер-зрительское — выбором конструктора (решение Р3) ─────────────────────
// «Прочитал я» и «прочитали меня» — updateReadHistoryInbox и
// updateReadHistoryOutbox, два РАЗНЫХ конструктора. У нас это один кадр `read`
// с user_id внутри, и вывод «чьё это» повторён в трёх местах разбора на
// клиенте. Тот же класс, что pFlags.out у сообщения: тело кадра одно на всех
// получателей, а ответ на вопрос «чьё» — разный, и разводится он на момент
// рассылки.
//
// ── Что этот файл ПОКА не объявляет ─────────────────────────────────────────
// Шаг A порта закрывает кадры вокруг СООБЩЕНИЯ — те, что идут через журнал и
// воронки курсора. Кадры диалогов и пиров (draft/dialog_pin/dialog_mute/
// presence/typing/user_update), кадры без предмета в схеме (factcheck,
// checklist, giveaway, boost, тема чата) и транспортные кадры (hello/pong/ack)
// — следующие шаги, перечисленные в разборе. Пропуск назван, а не забыт.

// Значения дискриминатора `_` объединения Update.
const (
	UpdateNewMessageTag                 = "updateNewMessage"
	UpdateNewChannelMessageTag          = "updateNewChannelMessage"
	UpdateEditMessageTag                = "updateEditMessage"
	UpdateEditChannelMessageTag         = "updateEditChannelMessage"
	UpdateDeleteMessagesTag             = "updateDeleteMessages"
	UpdateDeleteChannelMessagesTag      = "updateDeleteChannelMessages"
	UpdateReadHistoryInboxTag           = "updateReadHistoryInbox"
	UpdateReadHistoryOutboxTag          = "updateReadHistoryOutbox"
	UpdateReadChannelInboxTag           = "updateReadChannelInbox"
	UpdateReadChannelOutboxTag          = "updateReadChannelOutbox"
	UpdateReadMessagesContentsTag       = "updateReadMessagesContents"
	UpdateChannelReadMessagesContentTag = "updateChannelReadMessagesContents"
	UpdatePinnedMessagesTag             = "updatePinnedMessages"
	UpdatePinnedChannelMessagesTag      = "updatePinnedChannelMessages"
	UpdateMessageReactionsTag           = "updateMessageReactions"
)

// PtsCountOne — на сколько кадр двигает курсор.
//
// У оригинала pts_count бывает больше единицы (удаление пачки сообщений — один
// кадр на несколько позиций курсора), у нас курсор плотный: каждая запись
// журнала двигает его ровно на единицу. Константа названа затем, чтобы это
// свойство было видно в коде, а не выводилось из того, что всюду написан 1.
const PtsCountOne = 1

// Update — объединение кадров реального времени.
type Update interface {
	isUpdate()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// ── Новое сообщение ─────────────────────────────────────────────────────────

// updateNewMessage#1f2b0afd message:Message pts:int pts_count:int = Update;
type UpdateNewMessage struct {
	Underscore string    `json:"_"`
	Message    MTMessage `json:"message"`
	Pts        int64     `json:"pts"`
	PtsCount   int       `json:"pts_count"`
}

func (UpdateNewMessage) isUpdate()     {}
func (u UpdateNewMessage) Tag() string { return u.Underscore }

// NewUpdateNewMessage — кадр «пришло сообщение» в личном чате или группе.
func NewUpdateNewMessage(m MTMessage, pts int64) UpdateNewMessage {
	return UpdateNewMessage{Underscore: UpdateNewMessageTag, Message: m, Pts: pts, PtsCount: PtsCountOne}
}

// updateNewChannelMessage#62ba04d9 message:Message pts:int pts_count:int
// = Update;
//
// Отдельный конструктор, а не флаг: у канала СВОЙ курсор, и вид доставки
// решает пир — ровно то же правило, которое бэкенд уже применил к самой
// отправке (развилка по типу пира в Send).
type UpdateNewChannelMessage struct {
	Underscore string    `json:"_"`
	Message    MTMessage `json:"message"`
	Pts        int64     `json:"pts"`
	PtsCount   int       `json:"pts_count"`
}

func (UpdateNewChannelMessage) isUpdate()     {}
func (u UpdateNewChannelMessage) Tag() string { return u.Underscore }

// NewUpdateNewChannelMessage — кадр «вышел пост канала»; pts — пер-канальный.
func NewUpdateNewChannelMessage(m MTMessage, channelPts int64) UpdateNewChannelMessage {
	return UpdateNewChannelMessage{Underscore: UpdateNewChannelMessageTag, Message: m,
		Pts: channelPts, PtsCount: PtsCountOne}
}

// ── Правка ──────────────────────────────────────────────────────────────────

// updateEditMessage#e40370a3 message:Message pts:int pts_count:int = Update;
//
// Кадр несёт сообщение ЦЕЛИКОМ, а не патч. Наш `edit_message` носил дифф
// (id + текст + сущности + дата правки + разметка), и это была вторая форма
// сообщения на проводе — долг, названный ещё в порту сообщения.
type UpdateEditMessage struct {
	Underscore string    `json:"_"`
	Message    MTMessage `json:"message"`
	Pts        int64     `json:"pts"`
	PtsCount   int       `json:"pts_count"`
}

func (UpdateEditMessage) isUpdate()     {}
func (u UpdateEditMessage) Tag() string { return u.Underscore }

func NewUpdateEditMessage(m MTMessage, pts int64) UpdateEditMessage {
	return UpdateEditMessage{Underscore: UpdateEditMessageTag, Message: m, Pts: pts, PtsCount: PtsCountOne}
}

// updateEditChannelMessage#1b3f4df7 message:Message pts:int pts_count:int
// = Update;
type UpdateEditChannelMessage struct {
	Underscore string    `json:"_"`
	Message    MTMessage `json:"message"`
	Pts        int64     `json:"pts"`
	PtsCount   int       `json:"pts_count"`
}

func (UpdateEditChannelMessage) isUpdate()     {}
func (u UpdateEditChannelMessage) Tag() string { return u.Underscore }

func NewUpdateEditChannelMessage(m MTMessage, channelPts int64) UpdateEditChannelMessage {
	return UpdateEditChannelMessage{Underscore: UpdateEditChannelMessageTag, Message: m,
		Pts: channelPts, PtsCount: PtsCountOne}
}

// ── Удаление ────────────────────────────────────────────────────────────────

// updateDeleteMessages#a20db0e5 messages:Vector<int> pts:int pts_count:int
// = Update;
//
// Номера ВЕКТОРОМ: у оригинала одно удаление снимает сразу пачку. Наш кадр нёс
// ровно один номер плюс собственный признак `for_me` («удалить у себя»), а в
// схеме предмета у него нет: «удалено у меня» — это тот же кадр, просто
// разосланный одному получателю.
type UpdateDeleteMessages struct {
	Underscore string  `json:"_"`
	Messages   []int64 `json:"messages"`
	Pts        int64   `json:"pts"`
	PtsCount   int     `json:"pts_count"`
}

func (UpdateDeleteMessages) isUpdate()     {}
func (u UpdateDeleteMessages) Tag() string { return u.Underscore }

func NewUpdateDeleteMessages(ids []int64, pts int64) UpdateDeleteMessages {
	return UpdateDeleteMessages{Underscore: UpdateDeleteMessagesTag, Messages: nonNilIDs(ids),
		Pts: pts, PtsCount: PtsCountOne}
}

// updateDeleteChannelMessages#c32d5b12 channel_id:long messages:Vector<int>
// pts:int pts_count:int = Update;
type UpdateDeleteChannelMessages struct {
	Underscore string  `json:"_"`
	ChannelID  int64   `json:"channel_id"`
	Messages   []int64 `json:"messages"`
	Pts        int64   `json:"pts"`
	PtsCount   int     `json:"pts_count"`
}

func (UpdateDeleteChannelMessages) isUpdate()     {}
func (u UpdateDeleteChannelMessages) Tag() string { return u.Underscore }

func NewUpdateDeleteChannelMessages(channelID int64, ids []int64, channelPts int64) UpdateDeleteChannelMessages {
	return UpdateDeleteChannelMessages{Underscore: UpdateDeleteChannelMessagesTag, ChannelID: channelID,
		Messages: nonNilIDs(ids), Pts: channelPts, PtsCount: PtsCountOne}
}

// ── Прочтение истории ───────────────────────────────────────────────────────

// updateReadHistoryInbox#9e84bc99 flags:# folder_id:flags.0?int peer:Peer
// top_msg_id:flags.1?int max_id:int still_unread_count:int pts:int
// pts_count:int = Update;
//
// «Прочитал Я»: горизонт МОЕГО чтения плюс сколько у меня осталось
// непрочитанным. Второй конструктор (Outbox) несёт горизонт СОБЕСЕДНИКА и
// счётчика не имеет вовсе — потому что чужой непрочитанный меня не касается.
type UpdateReadHistoryInbox struct {
	Underscore       string `json:"_"`
	Peer             Peer   `json:"peer"`
	MaxID            int64  `json:"max_id"`
	StillUnreadCount int    `json:"still_unread_count"`
	Pts              int64  `json:"pts"`
	PtsCount         int    `json:"pts_count"`
}

func (UpdateReadHistoryInbox) isUpdate()     {}
func (u UpdateReadHistoryInbox) Tag() string { return u.Underscore }

func NewUpdateReadHistoryInbox(peer Peer, maxID int64, stillUnread int, pts int64) UpdateReadHistoryInbox {
	return UpdateReadHistoryInbox{Underscore: UpdateReadHistoryInboxTag, Peer: peer, MaxID: maxID,
		StillUnreadCount: stillUnread, Pts: pts, PtsCount: PtsCountOne}
}

// updateReadHistoryOutbox#2f2f21bf peer:Peer max_id:int pts:int pts_count:int
// = Update;
type UpdateReadHistoryOutbox struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
	MaxID      int64  `json:"max_id"`
	Pts        int64  `json:"pts"`
	PtsCount   int    `json:"pts_count"`
}

func (UpdateReadHistoryOutbox) isUpdate()     {}
func (u UpdateReadHistoryOutbox) Tag() string { return u.Underscore }

func NewUpdateReadHistoryOutbox(peer Peer, maxID int64, pts int64) UpdateReadHistoryOutbox {
	return UpdateReadHistoryOutbox{Underscore: UpdateReadHistoryOutboxTag, Peer: peer, MaxID: maxID,
		Pts: pts, PtsCount: PtsCountOne}
}

// updateReadChannelInbox#922e6e10 flags:# folder_id:flags.0?int channel_id:long
// max_id:int still_unread_count:int pts:int = Update;
//
// pts_count у канального прочтения нет — и это не пропуск схемы, а её ответ:
// пер-канальный курсор двигают только сообщения.
type UpdateReadChannelInbox struct {
	Underscore       string `json:"_"`
	ChannelID        int64  `json:"channel_id"`
	MaxID            int64  `json:"max_id"`
	StillUnreadCount int    `json:"still_unread_count"`
	Pts              int64  `json:"pts"`
}

func (UpdateReadChannelInbox) isUpdate()     {}
func (u UpdateReadChannelInbox) Tag() string { return u.Underscore }

func NewUpdateReadChannelInbox(channelID, maxID int64, stillUnread int, pts int64) UpdateReadChannelInbox {
	return UpdateReadChannelInbox{Underscore: UpdateReadChannelInboxTag, ChannelID: channelID,
		MaxID: maxID, StillUnreadCount: stillUnread, Pts: pts}
}

// updateReadChannelOutbox#b75f99a9 channel_id:long max_id:int = Update;
type UpdateReadChannelOutbox struct {
	Underscore string `json:"_"`
	ChannelID  int64  `json:"channel_id"`
	MaxID      int64  `json:"max_id"`
}

func (UpdateReadChannelOutbox) isUpdate()     {}
func (u UpdateReadChannelOutbox) Tag() string { return u.Underscore }

func NewUpdateReadChannelOutbox(channelID, maxID int64) UpdateReadChannelOutbox {
	return UpdateReadChannelOutbox{Underscore: UpdateReadChannelOutboxTag, ChannelID: channelID, MaxID: maxID}
}

// ── Прочтение вложений (голосовое, кружок) ──────────────────────────────────

// updateReadMessagesContents#f8227181 flags:# messages:Vector<int> pts:int
// pts_count:int date:flags.0?int = Update;
type UpdateReadMessagesContents struct {
	Underscore string  `json:"_"`
	Messages   []int64 `json:"messages"`
	Pts        int64   `json:"pts"`
	PtsCount   int     `json:"pts_count"`
}

func (UpdateReadMessagesContents) isUpdate()     {}
func (u UpdateReadMessagesContents) Tag() string { return u.Underscore }

func NewUpdateReadMessagesContents(ids []int64, pts int64) UpdateReadMessagesContents {
	return UpdateReadMessagesContents{Underscore: UpdateReadMessagesContentsTag, Messages: nonNilIDs(ids),
		Pts: pts, PtsCount: PtsCountOne}
}

// updateChannelReadMessagesContents#25f324f7 flags:# channel_id:long
// top_msg_id:flags.0?int saved_peer_id:flags.1?Peer messages:Vector<int>
// = Update;
type UpdateChannelReadMessagesContents struct {
	Underscore string  `json:"_"`
	ChannelID  int64   `json:"channel_id"`
	Messages   []int64 `json:"messages"`
}

func (UpdateChannelReadMessagesContents) isUpdate()     {}
func (u UpdateChannelReadMessagesContents) Tag() string { return u.Underscore }

func NewUpdateChannelReadMessagesContents(channelID int64, ids []int64) UpdateChannelReadMessagesContents {
	return UpdateChannelReadMessagesContents{Underscore: UpdateChannelReadMessagesContentTag,
		ChannelID: channelID, Messages: nonNilIDs(ids)}
}

// ── Закрепление ─────────────────────────────────────────────────────────────

// updatePinnedMessages#ed85eab5 flags:# pinned:flags.0?true peer:Peer
// messages:Vector<int> pts:int pts_count:int = Update;
//
// «Открепили» — ТОТ ЖЕ конструктор с опущенным битом, а не второй кадр и не
// поле `pinned: false`. Ровно то правило, которое кодек TL теперь держит
// ошибкой: «выключено» это отсутствие ключа.
type UpdatePinnedMessages struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Peer       Peer            `json:"peer"`
	Messages   []int64         `json:"messages"`
	Pts        int64           `json:"pts"`
	PtsCount   int             `json:"pts_count"`
}

func (UpdatePinnedMessages) isUpdate()     {}
func (u UpdatePinnedMessages) Tag() string { return u.Underscore }

// Pinned — закрепили (иначе открепили).
func (u UpdatePinnedMessages) Pinned() bool { return u.PFlags["pinned"] }

func NewUpdatePinnedMessages(peer Peer, ids []int64, pinned bool, pts int64) UpdatePinnedMessages {
	u := UpdatePinnedMessages{Underscore: UpdatePinnedMessagesTag, Peer: peer, Messages: nonNilIDs(ids),
		Pts: pts, PtsCount: PtsCountOne}
	if pinned {
		u.PFlags = map[string]bool{"pinned": true}
	}
	return u
}

// updatePinnedChannelMessages#5bb98608 flags:# pinned:flags.0?true
// channel_id:long messages:Vector<int> pts:int pts_count:int = Update;
type UpdatePinnedChannelMessages struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ChannelID  int64           `json:"channel_id"`
	Messages   []int64         `json:"messages"`
	Pts        int64           `json:"pts"`
	PtsCount   int             `json:"pts_count"`
}

func (UpdatePinnedChannelMessages) isUpdate()     {}
func (u UpdatePinnedChannelMessages) Tag() string { return u.Underscore }

func (u UpdatePinnedChannelMessages) Pinned() bool { return u.PFlags["pinned"] }

func NewUpdatePinnedChannelMessages(channelID int64, ids []int64, pinned bool, channelPts int64) UpdatePinnedChannelMessages {
	u := UpdatePinnedChannelMessages{Underscore: UpdatePinnedChannelMessagesTag, ChannelID: channelID,
		Messages: nonNilIDs(ids), Pts: channelPts, PtsCount: PtsCountOne}
	if pinned {
		u.PFlags = map[string]bool{"pinned": true}
	}
	return u
}

// ── Реакции ─────────────────────────────────────────────────────────────────

// updateMessageReactions#1e297bfa flags:# peer:Peer msg_id:int
// top_msg_id:flags.0?int saved_peer_id:flags.1?Peer reactions:MessageReactions
// = Update;
//
// Кадр несёт АБСОЛЮТНОЕ состояние реакций сообщения — и только его. Наш
// `reaction` вёз две формы одного факта сразу: авторитетный агрегат counts и
// дифф (кто, какой эмодзи, добавил или снял) для анимации. У оригинала дифф
// выводит КЛИЕНТ — из разницы с тем состоянием, которое у него уже есть
// (appReactionsManager), — поэтому при гонке двух реакций верить разным полям
// по-разному невозможно: поле одно.
//
// Платная (⭐) реакция отдельным кадром тоже не является: она лежит внутри
// MessageReactions вместе с обычными.
type UpdateMessageReactions struct {
	Underscore string           `json:"_"`
	Peer       Peer             `json:"peer"`
	MsgID      int64            `json:"msg_id"`
	Reactions  MessageReactions `json:"reactions"`
}

func (UpdateMessageReactions) isUpdate()     {}
func (u UpdateMessageReactions) Tag() string { return u.Underscore }

func NewUpdateMessageReactions(peer Peer, msgID int64, reactions MessageReactions) UpdateMessageReactions {
	return UpdateMessageReactions{Underscore: UpdateMessageReactionsTag, Peer: peer, MsgID: msgID,
		Reactions: reactions}
}

// nonNilIDs — пустой вектор остаётся вектором.
//
// На JSON-проводе nil стал бы `null`, а на проводе TL вектор обязателен: у него
// есть шапка со счётчиком, и «нет значения» для него невыразимо.
func nonNilIDs(ids []int64) []int64 {
	if ids == nil {
		return []int64{}
	}
	return ids
}
