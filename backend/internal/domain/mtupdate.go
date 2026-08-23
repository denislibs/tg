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
//
// Объявлено ровно то, что ПРОИЗВОДИТСЯ. Канальных близнецов правки, прочтения
// и закрепления (updateEditChannelMessage, updateReadChannelInbox/Outbox,
// updatePinnedChannelMessages) здесь нет намеренно: эти кадры у нас
// доставляются пер-юзерным веером со своим курсором, и канальный конструктор
// на пер-юзерном курсоре соврал бы о том, какой курсор двигать (то же
// основание записано у editMessagePayload). Они вернутся вместе с переводом
// этих кадров на журнал канала — долг ДОСТАВКИ, названный в разборе.
const (
	UpdateNewMessageTag               = "updateNewMessage"
	UpdateNewChannelMessageTag        = "updateNewChannelMessage"
	UpdateEditMessageTag              = "updateEditMessage"
	UpdateDeletePeerMessagesTag       = "updateDeletePeerMessages"
	UpdateReadHistoryInboxTag         = "updateReadHistoryInbox"
	UpdateReadHistoryOutboxTag        = "updateReadHistoryOutbox"
	UpdateReadPeerMessagesContentsTag = "updateReadPeerMessagesContents"
	UpdatePinnedMessagesTag           = "updatePinnedMessages"
	UpdateMessageReactionsTag         = "updateMessageReactions"
	UpdateDialogPinnedTag             = "updateDialogPinned"
	UpdateFolderPeersTag              = "updateFolderPeers"
	UpdateNotifySettingsTag           = "updateNotifySettings"
	UpdateDraftMessageTag             = "updateDraftMessage"
	UpdateUserTypingTag               = "updateUserTyping"
	UpdateChannelUserTypingTag        = "updateChannelUserTyping"
	UpdateUserStatusTag               = "updateUserStatus"
	UpdateUserSnapshotTag             = "updateUserSnapshot"
	UpdateMessagePollTag              = "updateMessagePoll"
	UpdateMessageExtendedMediaTag     = "updateMessageExtendedMedia"
	UpdateMessageWebPageTag           = "updateMessageWebPage"
	UpdateMessageFactCheckTag         = "updateMessageFactCheck"
	UpdateMessageToDoTag              = "updateMessageToDo"
	UpdateMessageGiveawayTag          = "updateMessageGiveaway"
	UpdateChatRemovedTag              = "updateChatRemoved"
	UpdateChatThemeTag                = "updateChatTheme"
	UpdateChatFullSnapshotTag         = "updateChatFullSnapshot"
	UpdateChannelFullSnapshotTag      = "updateChannelFullSnapshot"
	UpdateChannelBoostStatusTag       = "updateChannelBoostStatus"
	UpdateStarsBalanceTag             = "updateStarsBalance"
	UpdateBotCallbackAnswerTag        = "updateBotCallbackAnswer"
	UpdateStoryTag                    = "updateStory"
	UpdateSentStoryReactionTag        = "updateSentStoryReaction"
	UpdateReadStoriesTag              = "updateReadStories"
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

// updateUserSnapshot#47fb7ea6 user:User = Update; — НАШ конструктор.
//
// В схеме на этом месте updateUser{user_id}: кадр говорит «перечитай карточку»,
// а сама карточка едет рядом — вектором `users` КОНТЕЙНЕРА updates. Контейнера
// у нас пока нет (решение Р7 разбора), значит выбор такой: либо отдать один id
// и получить шторм запросов карточки на каждую смену аватарки у популярного
// собеседника (механизма дедупликации запросов, который у оригинала стоит в
// appUsersManager, у нас нет), либо везти карточку в самом кадре.
//
// Выбрано второе — тем же решением, что уже принято по chat_update. Это
// отступление уровня «предмет есть, но другой природы», и потому оно объявлено
// СВОИМ конструктором с явным id, а не подмешано параметром в схемный: чужой
// разбор увидит незнакомый id и остановится, а не прочитает мусор.
//
// Конструктор ВРЕМЕННЫЙ по построению: когда появится контейнер updates с
// вектором users, он уступит место паре updateUser{user_id} + users:[user].
type UpdateUserSnapshot struct {
	Underscore string   `json:"_"`
	User       UserReal `json:"user"`
}

func (UpdateUserSnapshot) isUpdate()     {}
func (u UpdateUserSnapshot) Tag() string { return u.Underscore }

func NewUpdateUserSnapshot(user UserReal) UpdateUserSnapshot {
	return UpdateUserSnapshot{Underscore: UpdateUserSnapshotTag, User: user}
}

// ── Вложения, меняющиеся после отправки ─────────────────────────────────────
//
// Опрос, чек-лист, розыгрыш, превью ссылки, проверка факта и платное медиа
// живут ВНУТРИ сообщения и меняются уже после его отправки. У всех шести кадр
// вёз объект под нашим ключом (`media`, `factcheck`) без дискриминатора самого
// кадра — то есть вид кадра снова выражала строка `t`.
//
// Адресация у них разная, и это не небрежность, а свойство предмета:
//   - опрос, чек-лист, розыгрыш адресуются СВОИМ id ВНУТРИ объекта (у
//     оригинала updateMessagePoll именно так и устроен: poll_id снаружи,
//     сообщение — необязательная подсказка);
//   - превью ссылки, проверка факта и платное медиа — парой «пир + номер»,
//     потому что своего id у них нет вовсе.

// updateMessagePoll#d64c522b flags:# peer:flags.1?Peer msg_id:flags.1?int
// top_msg_id:flags.2?int poll_id:long poll:flags.0?Poll results:PollResults
// = Update;
//
// Итоги опроса. Кадр несёт их АБСОЛЮТНО и помечен pollResults.min: тело одно на
// всех получателей, а мой выбор — пер-зрительский.
//
// peer производится, хотя у оригинала он лишь подсказка: наши окна сообщений
// разложены ПО ЧАТАМ, и без ключа пира клиенту пришлось бы искать опрос во всех
// сразу. Схема это допускает штатно — параметр за битом flags.1.
//
// msg_id не производится: у нас опрос ищется по своему id внутри окна пира, и
// второе число адреса ничего не добавит.
type UpdateMessagePoll struct {
	Underscore string      `json:"_"`
	Peer       Peer        `json:"peer,omitempty"`
	PollID     int64       `json:"poll_id"`
	Poll       *MTPoll     `json:"poll,omitempty"`
	Results    PollResults `json:"results"`
}

func (UpdateMessagePoll) isUpdate()     {}
func (u UpdateMessagePoll) Tag() string { return u.Underscore }

func NewUpdateMessagePoll(peer Peer, poll MTPoll, results PollResults) UpdateMessagePoll {
	return UpdateMessagePoll{Underscore: UpdateMessagePollTag, Peer: peer, PollID: poll.ID,
		Poll: &poll, Results: results}
}

// updateMessageExtendedMedia#d5a41724 peer:Peer msg_id:int
// extended_media:Vector<MessageExtendedMedia> = Update;
//
// Платное вложение РАЗБЛОКИРОВАНО. Прежде кадр вёз сообщение ЦЕЛИКОМ (тот же
// payload, что у нового сообщения) — то есть на разблокировку одного вложения
// приезжала вторая копия всего сообщения. В схеме едет ровно предмет: вектор
// позиций, ставших настоящими вместо заглушек.
type UpdateMessageExtendedMedia struct {
	Underscore    string                 `json:"_"`
	Peer          Peer                   `json:"peer"`
	MsgID         int64                  `json:"msg_id"`
	ExtendedMedia []MessageExtendedMedia `json:"extended_media"`
}

func (UpdateMessageExtendedMedia) isUpdate()     {}
func (u UpdateMessageExtendedMedia) Tag() string { return u.Underscore }

func NewUpdateMessageExtendedMedia(peer Peer, msgID int64, media []MessageExtendedMedia) UpdateMessageExtendedMedia {
	if media == nil {
		media = []MessageExtendedMedia{}
	}
	return UpdateMessageExtendedMedia{Underscore: UpdateMessageExtendedMediaTag, Peer: peer,
		MsgID: msgID, ExtendedMedia: media}
}

// updateMessageWebPage#5b9dbaaf peer:Peer msg_id:int media:MessageMedia
// = Update; — НАШ конструктор.
//
// В схеме это updateWebPage{webpage, pts, pts_count}: превью адресуется СВОИМ
// id, потому что у оригинала webPage — самостоятельный объект хранилища. У нас
// превью это СНИМОК на сообщении (см. OmittedWithoutSubject: у webPage не
// производятся ни id, ни hash), и адресовать его нечем, кроме пары «пир +
// номер». Тот же класс отступления, что у удаления и прочтения вложений.
type UpdateMessageWebPage struct {
	Underscore string       `json:"_"`
	Peer       Peer         `json:"peer"`
	MsgID      int64        `json:"msg_id"`
	Media      MessageMedia `json:"media"`
}

func (UpdateMessageWebPage) isUpdate()     {}
func (u UpdateMessageWebPage) Tag() string { return u.Underscore }

func NewUpdateMessageWebPage(peer Peer, msgID int64, media MessageMedia) UpdateMessageWebPage {
	return UpdateMessageWebPage{Underscore: UpdateMessageWebPageTag, Peer: peer, MsgID: msgID, Media: media}
}

// updateMessageFactCheck#a3438564 flags:# peer:Peer msg_id:int
// factcheck:flags.0?FactCheck = Update; — НАШ конструктор.
//
// Проверки факта апдейтом в схеме нет вовсе (сам factCheck есть — он приезжает
// внутри сообщения). «Проверку сняли» — ОТСУТСТВИЕ параметра, а не null: то же
// правило, по которому «черновика нет» стало вторым конструктором.
type UpdateMessageFactCheck struct {
	Underscore string     `json:"_"`
	Peer       Peer       `json:"peer"`
	MsgID      int64      `json:"msg_id"`
	FactCheck  *FactCheck `json:"factcheck,omitempty"`
}

func (UpdateMessageFactCheck) isUpdate()     {}
func (u UpdateMessageFactCheck) Tag() string { return u.Underscore }

func NewUpdateMessageFactCheck(peer Peer, msgID int64, fc *FactCheck) UpdateMessageFactCheck {
	return UpdateMessageFactCheck{Underscore: UpdateMessageFactCheckTag, Peer: peer, MsgID: msgID, FactCheck: fc}
}

// updateMessageToDo#0c0ae846 peer:Peer media:MessageMedia = Update; — НАШ
// конструктор.
//
// Чек-лист (todoList в схеме) апдейта не имеет. Внутри окна пира адресуется
// своим id — как опрос, и по той же причине: объект самостоятельный.
type UpdateMessageToDo struct {
	Underscore string       `json:"_"`
	Peer       Peer         `json:"peer"`
	Media      MessageMedia `json:"media"`
}

func (UpdateMessageToDo) isUpdate()     {}
func (u UpdateMessageToDo) Tag() string { return u.Underscore }

func NewUpdateMessageToDo(peer Peer, media MessageMedia) UpdateMessageToDo {
	return UpdateMessageToDo{Underscore: UpdateMessageToDoTag, Peer: peer, Media: media}
}

// updateMessageGiveaway#9d6f7d8e peer:Peer media:MessageMedia = Update; — НАШ
// конструктор.
//
// Розыгрыш меняется (участники, итоги) — апдейта в схеме нет. Внутри окна пира
// адресуется своим id, как опрос и чек-лист.
type UpdateMessageGiveaway struct {
	Underscore string       `json:"_"`
	Peer       Peer         `json:"peer"`
	Media      MessageMedia `json:"media"`
}

func (UpdateMessageGiveaway) isUpdate()     {}
func (u UpdateMessageGiveaway) Tag() string { return u.Underscore }

func NewUpdateMessageGiveaway(peer Peer, media MessageMedia) UpdateMessageGiveaway {
	return UpdateMessageGiveaway{Underscore: UpdateMessageGiveawayTag, Peer: peer, Media: media}
}

// ── Чат и профиль ───────────────────────────────────────────────────────────

// updateChatRemoved#8ffbdcd5 peer:Peer = Update; — НАШ конструктор.
//
// «Чат исчез» предмета в схеме не имеет вовсе (разбор Р4): у оригинала выход
// выражается сообщением-действием и перечитыванием карточки. Наш кадр
// существует, потому что список чатов у нас владелец правит операцией, а не
// перечитывает целиком.
//
// Поле `removed: true` из тела ушло: оно было константой — «кадр удаления
// сообщает об удалении». Вид кадра теперь несёт дискриминатор.
type UpdateChatRemoved struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
}

func (UpdateChatRemoved) isUpdate()     {}
func (u UpdateChatRemoved) Tag() string { return u.Underscore }

func NewUpdateChatRemoved(peer Peer) UpdateChatRemoved {
	return UpdateChatRemoved{Underscore: UpdateChatRemovedTag, Peer: peer}
}

// updateStory#75b3b798 peer:Peer story:StoryItem = Update;
//
// История появилась ЛИБО исчезла — различает это конструктор ВНУТРИ: `storyItem`
// значит «вот она», `storyItemDeleted` — «её больше нет». Прежде это были два
// собственных типа кадра (`story_new` и `story_deleted`), причём второй нёс
// только номер: получатель отличал их по имени конверта, а не по предмету.
//
// История едет ЦЕЛИКОМ — тем же конструктором, что и на витрине, вместе со
// ступенью медиа. Плоский кадр прошлой формы построить историю не мог (в нём был
// только номер файла), и витрине приходилось перечитывать ленту.
//
// Своего pts у конструктора нет: кадр эфемерный.
type UpdateStory struct {
	Underscore string    `json:"_"`
	Peer       Peer      `json:"peer"`
	Story      StoryItem `json:"story"`
}

func (UpdateStory) isUpdate()     {}
func (u UpdateStory) Tag() string { return u.Underscore }

func NewUpdateStory(peer Peer, story StoryItem) UpdateStory {
	return UpdateStory{Underscore: UpdateStoryTag, Peer: peer, Story: story}
}

// updateReadStories#f74e932b peer:Peer max_id:int = Update;
//
// ГОРИЗОНТ прочтения историй автора сдвинулся — один номер вместо признака на
// каждой истории, ровно как `updateReadHistoryInbox` у сообщений. Кадр уезжает
// на ДРУГИЕ устройства зрителя: кольцо непрочитанного должно гаснуть везде, а
// не только там, где историю открыли.
//
// Прежде прочтение не рассылалось вовсе — вторая вкладка о нём не узнавала.
type UpdateReadStories struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
	MaxID      int    `json:"max_id"`
}

func (UpdateReadStories) isUpdate()     {}
func (u UpdateReadStories) Tag() string { return u.Underscore }

func NewUpdateReadStories(peer Peer, maxID int) UpdateReadStories {
	return UpdateReadStories{Underscore: UpdateReadStoriesTag, Peer: peer, MaxID: maxID}
}

// updateSentStoryReaction#7d627683 peer:Peer story_id:int reaction:Reaction = Update;
//
// «Я поставил реакцию на историю» — эхо СВОЕГО действия на другие устройства
// зрителя. Общий агрегат сюда не входит и входить не может: он одинаков для
// всех получателей и едет внутри самой истории (`storyViews`), а здесь живёт
// ровно пер-зрительская часть — та же граница, что у `sent_reaction`.
//
// Прежний кадр `story_reaction` смешивал оба: нёс `reactions_count` вместе с
// `user_id`, и получатель решал «моё ли это» сравнением с собой.
type UpdateSentStoryReaction struct {
	Underscore string   `json:"_"`
	Peer       Peer     `json:"peer"`
	StoryID    int      `json:"story_id"`
	Reaction   Reaction `json:"reaction"`
}

func (UpdateSentStoryReaction) isUpdate()     {}
func (u UpdateSentStoryReaction) Tag() string { return u.Underscore }

func NewUpdateSentStoryReaction(peer Peer, storyID int, reaction Reaction) UpdateSentStoryReaction {
	return UpdateSentStoryReaction{Underscore: UpdateSentStoryReactionTag, Peer: peer, StoryID: storyID, Reaction: reaction}
}

// updateChatTheme#88ce5c7f peer:Peer theme_id:string = Update; — НАШ конструктор.
//
// В схеме есть updateTheme, но он про ГЛОБАЛЬНУЮ тему оформления приложения, а
// не про тему конкретного чата; сама тема чата у нас уже объявлена расхождением
// со схемой (у оригинала это emoticon набора, у нас — свой идентификатор).
type UpdateChatTheme struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
	ThemeID    string `json:"theme_id"`
}

func (UpdateChatTheme) isUpdate()     {}
func (u UpdateChatTheme) Tag() string { return u.Underscore }

func NewUpdateChatTheme(peer Peer, themeID string) UpdateChatTheme {
	return UpdateChatTheme{Underscore: UpdateChatThemeTag, Peer: peer, ThemeID: themeID}
}

// updateChatFullSnapshot#e4718e56 peer:Peer chat_full:messages.ChatFull pts:int
// pts_count:int = Update; — НАШ конструктор.
//
// В схеме на этом месте updateChat/updateChannel: кадр несёт ТОЛЬКО id —
// «перечитай карточку». Основание не идти за схемой записано до порта (разбор
// Р4): за кадром-«перечитай» у оригинала стоит дедупликация запросов
// (appChatsManager), которой у нас нет, и на каждое переименование в большой
// группе мы получили бы шторм запросов карточки. Тот же выбор, что у
// updateUserSnapshot, и такой же временный: с приходом контейнера updates
// карточка уедет в вектор chats.
//
// Курсор ВНУТРИ конструктора, потому что он у этого кадра пер-КАНАЛЬНЫЙ, а
// своего имени у канального курсора в схеме нет: `pts` у updateNewChannelMessage
// — обычный pts, канальный он потому, что таков КОНСТРУКТОР. Ключ `channel_pts`
// был вторым именем того же поля.
type UpdateChatFullSnapshot struct {
	Underscore string           `json:"_"`
	Peer       Peer             `json:"peer"`
	ChatFull   MessagesChatFull `json:"chat_full"`
	Pts        int64            `json:"pts"`
	PtsCount   int              `json:"pts_count"`
}

func (UpdateChatFullSnapshot) isUpdate()     {}
func (u UpdateChatFullSnapshot) Tag() string { return u.Underscore }

func NewUpdateChatFullSnapshot(peer Peer, full MessagesChatFull, pts int64) UpdateChatFullSnapshot {
	return UpdateChatFullSnapshot{Underscore: UpdateChatFullSnapshotTag, Peer: peer,
		ChatFull: full, Pts: pts, PtsCount: PtsCountOne}
}

// updateChannelFullSnapshot#572874a4 peer:Peer chat_full:messages.ChatFull
// pts:int pts_count:int = Update; — НАШ конструктор.
//
// Тот же снимок, что updateChatFullSnapshot, и отличается ровно КУРСОРОМ:
// этот кадр едет журналом КАНАЛА (пер-канальный плотный pts), а тот —
// пер-юзерным веером участников группы.
//
// Второй конструктор здесь не дубль, а ответ схемы на этот самый вопрос:
// updateNewMessage/updateNewChannelMessage, updateEditMessage/
// updateEditChannelMessage, updatePinnedMessages/updatePinnedChannelMessages —
// везде предмет один, а курсоров два, и различает их КОНСТРУКТОР. Одного
// конструктора на оба журнала не хватает буквально: получатель обязан решить,
// какой курсор двигать, а по снимку карточки этого не видно — наша группа в
// модели тоже channel (решение №2 порта пиров), и «канальность» здесь свойство
// доставки, а не предмета.
//
// Временный ровно настолько же, насколько updateChatFullSnapshot: с приходом
// контейнера updates карточка уедет в вектор chats.
type UpdateChannelFullSnapshot struct {
	Underscore string           `json:"_"`
	Peer       Peer             `json:"peer"`
	ChatFull   MessagesChatFull `json:"chat_full"`
	Pts        int64            `json:"pts"`
	PtsCount   int              `json:"pts_count"`
}

func (UpdateChannelFullSnapshot) isUpdate()     {}
func (u UpdateChannelFullSnapshot) Tag() string { return u.Underscore }

func NewUpdateChannelFullSnapshot(peer Peer, full MessagesChatFull, pts int64) UpdateChannelFullSnapshot {
	return UpdateChannelFullSnapshot{Underscore: UpdateChannelFullSnapshotTag, Peer: peer,
		ChatFull: full, Pts: pts, PtsCount: PtsCountOne}
}

// updateChannelBoostStatus#a92ed48e peer:Peer status:premium.BoostsStatus
// pts:int pts_count:int = Update; — НАШ конструктор.
//
// Кадр бустов зрителю в схеме отсутствует: updateBotChatBoost — апдейт БОТА,
// который следит за бустами чужого канала, а не зрителя. Сам статус при этом
// предмет схемный (premium.boostsStatus), и едет он им.
type UpdateChannelBoostStatus struct {
	Underscore string              `json:"_"`
	Peer       Peer                `json:"peer"`
	Status     PremiumBoostsStatus `json:"status"`
	Pts        int64               `json:"pts"`
	PtsCount   int                 `json:"pts_count"`
}

func (UpdateChannelBoostStatus) isUpdate()     {}
func (u UpdateChannelBoostStatus) Tag() string { return u.Underscore }

func NewUpdateChannelBoostStatus(peer Peer, status PremiumBoostsStatus, pts int64) UpdateChannelBoostStatus {
	return UpdateChannelBoostStatus{Underscore: UpdateChannelBoostStatusTag, Peer: peer,
		Status: status, Pts: pts, PtsCount: PtsCountOne}
}

// updateStarsBalance#4e80a379 balance:StarsAmount = Update;
//
// Баланс звёзд. Само число едет конструктором starsAmount: у оригинала звёзды
// дробные (nanos — девять знаков после запятой), и «целое число звёзд» это
// частный случай, а не форма.
type UpdateStarsBalance struct {
	Underscore string      `json:"_"`
	Balance    StarsAmount `json:"balance"`
}

func (UpdateStarsBalance) isUpdate()     {}
func (u UpdateStarsBalance) Tag() string { return u.Underscore }

func NewUpdateStarsBalance(balance int64) UpdateStarsBalance {
	return UpdateStarsBalance{Underscore: UpdateStarsBalanceTag, Balance: NewStarsAmount(balance)}
}

// updateBotCallbackAnswer#7b984754 flags:# alert:flags.0?true message:string
// = Update; — НАШ конструктор.
//
// У оригинала это не апдейт вовсе, а ОТВЕТ метода
// messages.getBotCallbackAnswer. Кадр существует, потому что у нас ответ бота
// может прийти уже после таймаута синхронного ожидания, и показать его тогда
// можно только пушем.
//
// «Показать модалкой» — БИТ, а не поле `alert: false`: то же правило, что у
// закрепления. Текст назван `message` — тем же именем, что у самого сообщения.
type UpdateBotCallbackAnswer struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Message    string          `json:"message"`
}

func (UpdateBotCallbackAnswer) isUpdate()     {}
func (u UpdateBotCallbackAnswer) Tag() string { return u.Underscore }

func NewUpdateBotCallbackAnswer(message string, alert bool) UpdateBotCallbackAnswer {
	u := UpdateBotCallbackAnswer{Underscore: UpdateBotCallbackAnswerTag, Message: message}
	setPFlag(&u.PFlags, "alert", alert)
	return u
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
