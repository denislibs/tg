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
	UpdateUserTypingTag               = "updateUserTyping"
	UpdateChannelUserTypingTag        = "updateChannelUserTyping"
	UpdateUserStatusTag               = "updateUserStatus"
)

// Значения дискриминатора `_` объединения SendMessageAction.
const (
	SendMessageTypingActionTag         = "sendMessageTypingAction"
	SendMessageRecordAudioActionTag    = "sendMessageRecordAudioAction"
	SendMessageRecordVideoActionTag    = "sendMessageRecordVideoAction"
	SendMessageUploadDocumentActionTag = "sendMessageUploadDocumentAction"
	SendMessageUploadPhotoActionTag    = "sendMessageUploadPhotoAction"
	SendMessageUploadVideoActionTag    = "sendMessageUploadVideoAction"
	SendMessageUploadAudioActionTag    = "sendMessageUploadAudioAction"
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

// ── Печатает: SendMessageAction ─────────────────────────────────────────────
//
// Что именно делает собеседник — ОБЪЕДИНЕНИЕ из 21 конструктора, а у нас это
// была строка из шести значений с дефолтом «typing». Седьмое место в программе,
// где вид сущности подделан строкой.
//
// Разница не в форме: у конструкторов sendMessageUpload*Action есть параметр
// `progress`, то есть у оригинала полоска «отправляет фото 40%» ВЫРАЗИМА, а у
// строки её выразить нечем. Мы его пока не производим (клиент не шлёт прогресс
// аплоада на пинге печати) — пропуск назван в OmittedWithoutSubject, и теперь
// это отсутствующее ЗНАЧЕНИЕ, а не отсутствующая возможность.
//
// Не производятся: sendMessageCancelAction («перестал печатать» у нас гасит
// TTL на клиенте, отдельного кадра нет), геолокация, выбор контакта, игра,
// кружок (record/upload Round), выступление в звонке, импорт истории, выбор
// стикера и эмодзи-интеракции — предмета нет ни у одного.
type SendMessageAction interface {
	isSendMessageAction()
	Tag() string
}

// sendMessageTypingAction#16bf744e = SendMessageAction;
type SendMessageTypingAction struct {
	Underscore string `json:"_"`
}

func (SendMessageTypingAction) isSendMessageAction() {}
func (a SendMessageTypingAction) Tag() string        { return a.Underscore }

// sendMessageRecordAudioAction#d52f73f7 = SendMessageAction; — наш «voice».
type SendMessageRecordAudioAction struct {
	Underscore string `json:"_"`
}

func (SendMessageRecordAudioAction) isSendMessageAction() {}
func (a SendMessageRecordAudioAction) Tag() string        { return a.Underscore }

// sendMessageRecordVideoAction#a187d66f = SendMessageAction; — наш «video».
type SendMessageRecordVideoAction struct {
	Underscore string `json:"_"`
}

func (SendMessageRecordVideoAction) isSendMessageAction() {}
func (a SendMessageRecordVideoAction) Tag() string        { return a.Underscore }

// sendMessageUploadDocumentAction#aa0cd9e4 progress:int = SendMessageAction;
// sendMessageUploadPhotoAction#d1d34a26 progress:int = SendMessageAction;
// sendMessageUploadVideoAction#e9763aec progress:int = SendMessageAction;
// sendMessageUploadAudioAction#f351d7ab progress:int = SendMessageAction;
//
// Четыре конструктора одной формы — «отправляет файл/фото/видео/аудио».
// `progress` обязателен и не производится (см. шапку раздела).
type SendMessageUploadAction struct {
	Underscore string `json:"_"`
}

func (SendMessageUploadAction) isSendMessageAction() {}
func (a SendMessageUploadAction) Tag() string        { return a.Underscore }

// SendMessageActionByTag — действие по ДИСКРИМИНАТОРУ с провода.
//
// Разбор здесь, а не в транспорте, ровно по той же причине, по какой сущности
// разбирает mtentity.go: список произведённых конструкторов один, и жить он
// обязан рядом с их объявлением. Неизвестный (или чужой из будущего) —
// обычная печать: индикатор существует, чтобы показывать активность, и
// молчание из-за незнакомого кода было бы хуже приблизительного ответа.
func SendMessageActionByTag(predicate string) SendMessageAction {
	switch predicate {
	case SendMessageRecordAudioActionTag:
		return SendMessageRecordAudioAction{Underscore: SendMessageRecordAudioActionTag}
	case SendMessageRecordVideoActionTag:
		return SendMessageRecordVideoAction{Underscore: SendMessageRecordVideoActionTag}
	case SendMessageUploadDocumentActionTag, SendMessageUploadPhotoActionTag,
		SendMessageUploadVideoActionTag, SendMessageUploadAudioActionTag:
		return SendMessageUploadAction{Underscore: predicate}
	}
	return SendMessageTypingAction{Underscore: SendMessageTypingActionTag}
}

// updateUserTyping#2a17bf5c flags:# user_id:long top_msg_id:flags.0?int
// action:SendMessageAction = Update;
//
// Печатают В ЛИЧНОМ чате. Ключа пира у кадра нет и не нужно: пир ЭТО и есть
// печатающий — у нас же ключ приклеивался снаружи, как у всех прочих кадров.
//
// top_msg_id (печатают в треде) не производится: тредового индикатора у нас нет.
type UpdateUserTyping struct {
	Underscore string            `json:"_"`
	UserID     int64             `json:"user_id"`
	Action     SendMessageAction `json:"action"`
}

func (UpdateUserTyping) isUpdate()     {}
func (u UpdateUserTyping) Tag() string { return u.Underscore }

func NewUpdateUserTyping(userID int64, action SendMessageAction) UpdateUserTyping {
	return UpdateUserTyping{Underscore: UpdateUserTypingTag, UserID: userID, Action: action}
}

// updateChannelUserTyping#8c88c923 flags:# channel_id:long top_msg_id:flags.0?int
// from_id:Peer action:SendMessageAction = Update;
//
// Печатают в ГРУППЕ или канале: адрес чата и автор — разные параметры, потому
// что это разные вопросы. Базового updateChatUserTyping мы не производим по той
// же причине, что и базового `chat`: любая наша группа — channel.
type UpdateChannelUserTyping struct {
	Underscore string            `json:"_"`
	ChannelID  int64             `json:"channel_id"`
	FromID     Peer              `json:"from_id"`
	Action     SendMessageAction `json:"action"`
}

func (UpdateChannelUserTyping) isUpdate()     {}
func (u UpdateChannelUserTyping) Tag() string { return u.Underscore }

func NewUpdateChannelUserTyping(channelID int64, from Peer, action SendMessageAction) UpdateChannelUserTyping {
	return UpdateChannelUserTyping{Underscore: UpdateChannelUserTypingTag, ChannelID: channelID,
		FromID: from, Action: action}
}

// updateUserStatus#e5bdf8de user_id:long status:UserStatus = Update;
//
// Присутствие. Сам статус объединением уже ехал (порт пиров: «онлайн» это
// userStatusOnline СО СРОКОМ, а скрытое приватностью — другой конструктор), а
// вот кадр вокруг него оставался словарём.
type UpdateUserStatus struct {
	Underscore string     `json:"_"`
	UserID     int64      `json:"user_id"`
	Status     UserStatus `json:"status"`
}

func (UpdateUserStatus) isUpdate()     {}
func (u UpdateUserStatus) Tag() string { return u.Underscore }

func NewUpdateUserStatus(userID int64, status UserStatus) UpdateUserStatus {
	return UpdateUserStatus{Underscore: UpdateUserStatusTag, UserID: userID, Status: status}
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
