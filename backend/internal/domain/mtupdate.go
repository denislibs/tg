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
	UpdateNewMessageTag               = "updateNewMessage"
	UpdateNewChannelMessageTag        = "updateNewChannelMessage"
	UpdateEditMessageTag              = "updateEditMessage"
	UpdateEditChannelMessageTag       = "updateEditChannelMessage"
	UpdateDeletePeerMessagesTag       = "updateDeletePeerMessages"
	UpdateReadHistoryInboxTag         = "updateReadHistoryInbox"
	UpdateReadHistoryOutboxTag        = "updateReadHistoryOutbox"
	UpdateReadChannelInboxTag         = "updateReadChannelInbox"
	UpdateReadChannelOutboxTag        = "updateReadChannelOutbox"
	UpdateReadPeerMessagesContentsTag = "updateReadPeerMessagesContents"
	UpdatePinnedMessagesTag           = "updatePinnedMessages"
	UpdatePinnedChannelMessagesTag    = "updatePinnedChannelMessages"
	UpdateMessageReactionsTag         = "updateMessageReactions"
	UpdateDialogPinnedTag             = "updateDialogPinned"
	UpdateFolderPeersTag              = "updateFolderPeers"
	UpdateNotifySettingsTag           = "updateNotifySettings"
	UpdateDraftMessageTag             = "updateDraftMessage"
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

// updateDeletePeerMessages#5ffab82e peer:Peer messages:Vector<int> pts:int
// pts_count:int = Update;
//
// НАШ конструктор (schema_additional_params.json), и причина не в удобстве.
// В схеме удаление адресуется `updateDeleteMessages{messages, pts, pts_count}`
// — БЕЗ пира, потому что у оригинала номер сообщения уникален в пределах
// «ящика» получателя. У нас номер пер-чатный (решение порта сообщения: наружу
// выходит номер в чате, а не ключ строки), поэтому один и тот же номер живёт в
// каждом чате, и кадр без пира невыразим — он бы означал «удалить сообщение
// №12 везде».
//
// То же самое у прочтения вложений (updateReadPeerMessagesContents ниже) — оба
// расхождения одного корня, и оба объявлены штатным механизмом оригинала, а не
// подмешаны в схемные конструкторы.
//
// Канальные варианты схемы (updateDeleteChannelMessages) нам сейчас не нужны:
// удаление и прочтение вложений идут ПЕР-ЮЗЕРНЫМ веером, а не через журнал
// канала, — и это отдельный долг доставки, а не формы.
//
// Номера ВЕКТОРОМ: у оригинала одно действие снимает сразу пачку. Наш кадр нёс
// один номер плюс собственный признак `for_me` («удалить у себя»), которого в
// схеме нет вовсе: «удалено у меня» это тот же кадр, просто разосланный одному
// получателю.
type UpdateDeletePeerMessages struct {
	Underscore string  `json:"_"`
	Peer       Peer    `json:"peer"`
	Messages   []int64 `json:"messages"`
	Pts        int64   `json:"pts"`
	PtsCount   int     `json:"pts_count"`
}

func (UpdateDeletePeerMessages) isUpdate()     {}
func (u UpdateDeletePeerMessages) Tag() string { return u.Underscore }

func NewUpdateDeletePeerMessages(peer Peer, ids []int64, pts int64) UpdateDeletePeerMessages {
	return UpdateDeletePeerMessages{Underscore: UpdateDeletePeerMessagesTag, Peer: peer,
		Messages: nonNilIDs(ids), Pts: pts, PtsCount: PtsCountOne}
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

// updateReadPeerMessagesContents#346a260f peer:Peer messages:Vector<int>
// pts:int pts_count:int = Update;
//
// НАШ конструктор по той же причине, что и удаление выше: схемный
// updateReadMessagesContents пира не несёт, а наша нумерация пер-чатная.
type UpdateReadPeerMessagesContents struct {
	Underscore string  `json:"_"`
	Peer       Peer    `json:"peer"`
	Messages   []int64 `json:"messages"`
	Pts        int64   `json:"pts"`
	PtsCount   int     `json:"pts_count"`
}

func (UpdateReadPeerMessagesContents) isUpdate()     {}
func (u UpdateReadPeerMessagesContents) Tag() string { return u.Underscore }

func NewUpdateReadPeerMessagesContents(peer Peer, ids []int64, pts int64) UpdateReadPeerMessagesContents {
	return UpdateReadPeerMessagesContents{Underscore: UpdateReadPeerMessagesContentsTag, Peer: peer,
		Messages: nonNilIDs(ids), Pts: pts, PtsCount: PtsCountOne}
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

// ── Диалоги ─────────────────────────────────────────────────────────────────

// updateDialogPinned#6e6fe51c flags:# pinned:flags.0?true folder_id:flags.1?int
// peer:DialogPeer = Update;
//
// «Открепили» — тот же конструктор с опущенным битом, как и у закрепления
// сообщения: поля `pinned: false` в схеме нет.
//
// folder_id не производится: закрепление у нас общее на весь список (лимит
// считается по пользователю, а не по папке), а «не указано» у оригинала и
// значит основной список.
//
// Своего pts у конструктора нет — курсор такого кадра едет в конверте
// (UpdateDeclaresPts, mtwire.go).
type UpdateDialogPinned struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Peer       DialogPeer      `json:"peer"`
}

func (UpdateDialogPinned) isUpdate()     {}
func (u UpdateDialogPinned) Tag() string { return u.Underscore }

// Pinned — закрепили (иначе открепили).
func (u UpdateDialogPinned) Pinned() bool { return u.PFlags["pinned"] }

func NewUpdateDialogPinned(peer Peer, pinned bool) UpdateDialogPinned {
	u := UpdateDialogPinned{Underscore: UpdateDialogPinnedTag, Peer: NewDialogPeer(peer)}
	if pinned {
		u.PFlags = map[string]bool{"pinned": true}
	}
	return u
}

// updateFolderPeers#19360dc0 folder_peers:Vector<FolderPeer> pts:int
// pts_count:int = Update;
//
// АРХИВ — ЭТО ПАПКА, а не признак. У нас кадр вёз `archived: bool`, и это тот же
// дефект, что мьют булевым: значение подделано признаком. В схеме диалог
// переезжает МЕЖДУ папками, номер папки едет рядом с пиром, и «вернуть из
// архива» это folder_id=0 — тем же кадром, а не вторым.
//
// Вектор, а не один пир: у оригинала одно действие переносит сразу пачку.
type UpdateFolderPeers struct {
	Underscore  string       `json:"_"`
	FolderPeers []FolderPeer `json:"folder_peers"`
	Pts         int64        `json:"pts"`
	PtsCount    int          `json:"pts_count"`
}

func (UpdateFolderPeers) isUpdate()     {}
func (u UpdateFolderPeers) Tag() string { return u.Underscore }

func NewUpdateFolderPeers(peers []FolderPeer, pts int64) UpdateFolderPeers {
	if peers == nil {
		peers = []FolderPeer{}
	}
	return UpdateFolderPeers{Underscore: UpdateFolderPeersTag, FolderPeers: peers,
		Pts: pts, PtsCount: PtsCountOne}
}

// updateNotifySettings#bec268ef peer:NotifyPeer notify_settings:PeerNotifySettings
// = Update;
//
// Настройки едут ЦЕЛИКОМ и абсолютно — тем же конструктором, что внутри
// диалога. Мьют здесь СРОК (mute_until), и порт разбора уже назвал, чего стоило
// булево: «заглушить на час» работало как «навсегда».
//
// Своего pts у конструктора нет — курсор едет в конверте.
type UpdateNotifySettings struct {
	Underscore     string             `json:"_"`
	Peer           NotifyPeer         `json:"peer"`
	NotifySettings PeerNotifySettings `json:"notify_settings"`
}

func (UpdateNotifySettings) isUpdate()     {}
func (u UpdateNotifySettings) Tag() string { return u.Underscore }

func NewUpdateNotifySettings(peer Peer, settings PeerNotifySettings) UpdateNotifySettings {
	return UpdateNotifySettings{Underscore: UpdateNotifySettingsTag,
		Peer: NewNotifyPeer(peer), NotifySettings: settings}
}

// updateDraftMessage#edfc111e flags:# peer:Peer top_msg_id:flags.0?int
// saved_peer_id:flags.1?Peer draft:DraftMessage = Update;
//
// Черновик изменился на другом устройстве. «Черновик снят» — не `draft: null`,
// а КОНСТРУКТОР draftMessageEmpty внутри того же параметра: отсутствие выражено
// выбором конструктора, а не значением.
//
// top_msg_id не производится: черновик у нас один на чат, тредового черновика
// нет ни в хранилище, ни в композере.
//
// Своего pts у конструктора нет — курсор такого кадра едет в конверте.
type UpdateDraftMessage struct {
	Underscore string       `json:"_"`
	Peer       Peer         `json:"peer"`
	Draft      DraftMessage `json:"draft"`
}

func (UpdateDraftMessage) isUpdate()     {}
func (u UpdateDraftMessage) Tag() string { return u.Underscore }

func NewUpdateDraftMessage(peer Peer, draft DraftMessage) UpdateDraftMessage {
	return UpdateDraftMessage{Underscore: UpdateDraftMessageTag, Peer: peer, Draft: draft}
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
