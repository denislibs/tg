package domain

import "time"

// Сообщение целиком в форме оригинала — конструкторы схемы TL (MTProto), а не
// плоская строка витрины `domain.Message` на сто полей.
//
// Шестая подсистема программы (docs/readiness/tl-program.md), и та, которой в
// списке подсистем не было: медиа, сущности и разметка считались её частями и
// были сделаны по отдельности, а сам конструктор так и не появился — порт
// диалогов в это упёрся (вектор `messages` контейнера `messages.dialogs`
// наполняет проводной рендерер из delivery/http, сверкой со схемой он не
// покрыт). Разбор подсистемы и решения Р1–Р7 —
// docs/readiness/tl-message-analysis.md.
//
// Правила фазы 0 (дискриминатор `_`, pFlags вместо flags, «выключено» это
// отсутствие ключа, у каждого конструктора своя структура) — в шапке mtpeer.go;
// продолжение mtdialog.go.
//
// ── Служебное сообщение — конструктор, а не значение поля ───────────────────
// У нас `Type string`, где "service" стоит наравне с "photo", "video", "poll".
// То есть одно поле отвечало на три разных вопроса: «это служебное?», «какое
// вложение?», «это шифрованное сообщение секретного чата?». В схеме первый
// вопрос — выбор конструктора (message | messageService), второй — объединение
// MessageMedia (порт медиа сделан), третий — отдельная подсистема
// EncryptedChat вне периметра.
//
// Вместе с `Type` уходит и JSON внутри текста: сейчас служебное действие едет
// строкой, которую клиент опознаёт по `raw.startsWith('{')` (serviceMsg.ts:43),
// то есть дискриминатор подделан ДВАЖДЫ. Здесь это action:MessageAction, и
// ветвление идёт по `_`, как везде.
//
// ── Что сервер производит, а что уточняет клиент ────────────────────────────
// Сервер производит только НАСТОЯЩИЕ конструкторы схемы; синтетические
// (messageActionChatLeave, messageActionChatJoined, messageActionChatReturn,
// messageActionChatAddUsers) — КЛИЕНТСКИЕ, они уже объявлены в
// schema_additional_params.json и в этой модели не появляются. Ровно так
// работает оригинал: appMessagesManager.ts:5233-5238 переписывает `_`, увидев
// `from_id == user_id` у messageActionChatDeleteUser (человек вышел сам) и
// уточняя messageActionChatAddUser до ChatJoined/ChatReturn/ChatAddUsers.
// Смешивать нельзя: серверная и клиентская формы разъедутся ровно там, где
// сейчас разъезжаются десять проводных форм сообщения.
//
// Прямое следствие: `leave` и `kick_user` — ОДИН конструктор на проводе
// (messageActionChatDeleteUser). Сервер сообщает факт, формулировку выбирает
// клиент.
//
// ── Чего в модели НЕТ и почему ──────────────────────────────────────────────
// Пропуски названы, а не забыты — молчаливый пропуск и есть тот способ, каким
// поля уходили из модели.
//
// Булевы флаги message, у которых предмета нет:
//   - out — предмет ЕСТЬ, но у клиента: решение Р7 оставляет `out` вычисляемым
//     (deriveOut по senderId === meId с поправкой на send-as). Сервер его не
//     производит, и ответ перестаёт зависеть от зрителя ещё в одном поле;
//   - silent — у нас это ПАРАМЕТР ОТПРАВКИ (SendInput.Silent гасит пуш) и
//     нигде не хранится: на отданном сообщении его нет, колонки нет;
//   - noforwards — защиты контента у чата нет ни колонкой, ни механикой;
//   - invert_media — «медиа под текстом» не умеет ни одна сторона;
//   - from_scheduled — отложенные сообщения есть, но признак «это сработавшее
//     отложенное» не хранится;
//   - legacy, edit_hide, offline, video_processing_pending,
//     paid_suggested_post_stars/ton — ни колонки, ни механики.
//
// Необязательные параметры message без предмета: saved_peer_id (сохранённых
// диалогов нет), via_bot_id и via_business_bot_id (инлайн-ботов нет),
// guestchat_via_from, from_boosts_applied, from_rank, restriction_reason,
// quick_reply_shortcut_id, report_delivery_until_date, paid_message_stars,
// suggested_post, schedule_repeat_period, summary_from_language, rich_message.
//
// Отдельно post_author (flags.16?string) — «подпись автора под постом канала».
// Подписи у канала есть (chats.signatures), но ИМЯ автора собирает клиент из
// from_id: серверная склейка имени — ровно то, что программа снимает с провода
// с тех пор, как у пиров ушёл display_name.
//
// ── Медиа: объединение уже, чем наша витрина ───────────────────────────────
// `media` типизировано существующим MessageMedia (mtmedia.go), и это по схеме
// верно, но неполно: там объявлены messageMediaPhoto и messageMediaDocument, а
// гео, контакт, опрос, чек-лист, розыгрыш, подарок и превью ссылки едут у нас
// собственными полями строки витрины. В схеме все они — конструкторы того же
// объединения (messageMediaGeo/GeoLive/Venue/Contact/Poll/ToDo/Giveaway/
// WebPage). Довести объединение до них — работа шага, который переселяет
// витрину; здесь это названо, чтобы не выглядело забытым.
//
// ── Разбора (UnmarshalJSON) в этом файле нет намеренно ──────────────────────
// В отличие от mtdialog.go, но ровно как в mtmedia.go. Сообщение НЕСЁТ
// MessageMedia, а у того векторы Vector<PhotoSize> и Vector<DocumentAttribute>
// — срезы интерфейсов, которые encoding/json заполнить не умеет. Разборщик
// сообщения поэтому падал бы на любом сообщении с превью документа, то есть
// был бы хуже, чем его отсутствие. Он появляется вместе с кодеком фазы 2 (или
// раньше — вместе с разбором медиа), а не сейчас.
//
// ── Идентичность (решение Р1) ───────────────────────────────────────────────
// `id` здесь — наш seq, номер сообщения ВНУТРИ чата: в схеме идентичность это
// пара «пир + id», и наш seq является ровно тем, чем в схеме является
// message.id (плотный, уникальный в пределах чата, назначается счётчиком
// last_seq). Глобальный messages.id остаётся ключом строки нашей базы и
// наружу не выходит — тот же ход, что порт пиров сделал с chats.id. Перевод
// адресации — следующий шаг; здесь это лишь тип и имя поля.

// ── Message: messageEmpty | message | messageService ────────────────────────

// MTMessage — объединение схемы Message: messageEmpty | message |
// messageService.
//
// Про префикс MT: имя `Message` в пакете занято строкой витрины
// (domain.Message), которая живёт ещё один шаг. Приём тот же, что у пиров на
// их шаге A — MTUser/MTChat, снятые на шаге C, когда старые структуры уехали в
// UserRecord/ChatRecord. Конструктор при этом называется окончательно:
// MessageReal — как UserReal, ChatReal, DialogReal, PhotoSizeReal (структура,
// названная именем собственного объединения).
type MTMessage interface {
	isMTMessage()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// Значения дискриминатора `_` объединения Message.
const (
	MessageEmptyTag   = "messageEmpty"
	MessageTag        = "message"
	MessageServiceTag = "messageService"
)

// messageEmpty#90a6ca84 flags:# id:int peer_id:flags.0?Peer = Message;
//
// ДЫРА В ИСТОРИИ: id известен, сообщения по нему нет. Не «удалённое сообщение»,
// а ОТСУТСТВИЕ объекта — ни даты, ни автора, ни текста у конструктора нет
// вовсе.
//
// Наш `Deleted bool` — это НЕ он. Tombstone отвечает на другой вопрос: строка
// в messages ещё цела (текст, медиа, автор на месте), у неё лишь проставлен
// deleted_at, и это внутреннее состояние хранилища. На провод оно не выходит
// никогда — все выборки истории фильтруют `deleted_at IS NULL`, поэтому ключ
// `deleted` уезжает в каждом ответе пустым. Поле остаётся ВНУТРЕННИМ (по нему
// стоят живые гейты правки, закрепления, пересылки, расшифровки), но проводного
// предмета у него нет, и в этой модели ему места нет.
//
// ОБЪЯВЛЕН, НО НЕ ПРОИЗВОДИТСЯ — по той же причине и тем же приёмом, что
// dialogFolder и базовый chat: конструктор входит в объединение, которым
// типизирован вектор messages контейнера, и чужой кадр с messageEmpty обязан
// пережить круг разбор → сборка на фазе 2. Конструирующей функции поэтому нет:
// собрать messageEmpty можно только литералом, и это видно в коде.
//
// Настоящий производитель у него есть, и он назван долгом шага витрин: сегодня
// на ссылку в удалённое сообщение (цель ответа, строка индекса закреплённых,
// корень треда) мы отдаём МОЛЧАНИЕ — объект просто отсутствует в векторе, и
// клиент не отличает «ещё не загружено» от «больше не существует».
type MessageEmpty struct {
	Underscore string `json:"_"`
	ID         int64  `json:"id"`
	// PeerID — flags.0?Peer. Имя поля повторяет имя параметра схемы (peer_id),
	// а тип — Peer: приём mtfwd.go, где from_id тоже ссылка на пир.
	PeerID Peer `json:"peer_id,omitempty"`
}

func (MessageEmpty) isMTMessage()  {}
func (m MessageEmpty) Tag() string { return m.Underscore }

// MessageFlags — булевы флаги message в форме, удобной для вызова: в pFlags
// попадают только выставленные. Перечислены ровно те, у которых есть предмет.
//
//	Mentioned   — сообщение упоминает зрителя (mentionedUserIDs + журнал
//	              непрочитанных упоминаний, ручка /mentions/next)
//	MediaUnread — голосовое/кружок ещё не прослушан получателем (messages.media_unread)
//	Post        — сообщение в вещательном канале. Сегодня этот же факт выражает
//	              ОТДЕЛЬНАЯ проводная форма (channelPostPayload) — решение Р5
//	              сводит десять форм к одной, и флаг схемы это ровно она
//	Pinned      — строка pinned_messages для этого сообщения
//
// Остальные булевы флаги схемы предмета не имеют либо принадлежат клиенту —
// см. шапку файла.
type MessageFlags struct {
	// Out — сообщение отправил ЗРИТЕЛЬ. Производит СЕРВЕР (отмена решения Р7 —
	// обоснование в докблоке MessageContext.Out): после порта у сообщения от
	// лица канала автором на проводе становится сам канал, и прежней формулы
	// клиента «автор это я» вывести стало не из чего.
	Out         bool
	Mentioned   bool
	MediaUnread bool
	Post        bool
	Pinned      bool
}

// message#7600b9d3 flags:# out:flags.1?true mentioned:flags.4?true
// media_unread:flags.5?true silent:flags.13?true post:flags.14?true
// pinned:flags.24?true noforwards:flags.26?true invert_media:flags.27?true
// flags2:# id:int from_id:flags.8?Peer peer_id:Peer
// fwd_from:flags.2?MessageFwdHeader reply_to:flags.3?MessageReplyHeader
// date:int message:string media:flags.9?MessageMedia
// reply_markup:flags.6?ReplyMarkup entities:flags.7?Vector<MessageEntity>
// views:flags.10?int forwards:flags.10?int replies:flags.23?MessageReplies
// edit_date:flags.15?int post_author:flags.16?string grouped_id:flags.17?long
// reactions:flags.20?MessageReactions ttl_period:flags.25?int
// effect:flags2.2?long factcheck:flags2.3?FactCheck = Message;
//
// ОБЫЧНОЕ сообщение. Имя структуры с суффиксом Real: `Message` — имя
// объединения (и пока — имя уходящей строки витрины), см. MTMessage.
//
// Про ДВА слова флагов (flags и flags2): на фазе 0 это не меняет ничего —
// pFlags плоский, а необязательность выражается отсутствием ключа независимо
// от того, в каком слове живёт бит. Раскладку потока это меняет только на
// фазе 2, у кодека.
type MessageReal struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// ID — номер сообщения ВНУТРИ чата (наш seq), решение Р1.
	ID int64 `json:"id"`
	// FromID — flags.8?Peer: автор. У поста канала автора нет — сообщение «от
	// самого пира», и параметр не ставится вовсе.
	FromID Peer `json:"from_id,omitempty"`
	// PeerID — обязательный: чат, которому сообщение принадлежит.
	PeerID Peer `json:"peer_id"`
	// FwdFrom — flags.2?MessageFwdHeader (mtfwd.go): атрибуция пересылки.
	FwdFrom *MessageFwdHeader `json:"fwd_from,omitempty"`
	// ReplyTo — flags.3?MessageReplyHeader: ССЫЛКА на отвечаемое сообщение, а
	// не его снимок (решение Р4).
	ReplyTo *MessageReplyHeader `json:"reply_to,omitempty"`
	// Date — обязательный, секунды эпохи.
	Date int `json:"date"`
	// Message — текст. Обязательный по схеме и едет ВСЕГДА, даже пустой: у
	// сообщения-картинки без подписи это пустая строка, а не отсутствие ключа.
	Message string `json:"message"`
	// Media — flags.9?MessageMedia (mtmedia.go). Про неполноту объединения см.
	// шапку файла.
	Media *MessageMedia `json:"media,omitempty"`
	// ReplyMarkup — flags.6?ReplyMarkup (mtreplymarkup.go).
	ReplyMarkup ReplyMarkup `json:"reply_markup,omitempty"`
	// Entities — flags.7?Vector<MessageEntity> (mtentity.go).
	Entities MessageEntities `json:"entities,omitempty"`
	// Views и Forwards делят ОДИН бит (flags.10): у оригинала они едут парой
	// или не едут вовсе. На фазе 0 это ничего не требует, на фазе 2 — требует.
	Views    int64 `json:"views,omitempty"`
	Forwards int64 `json:"forwards,omitempty"`
	// Replies — flags.23?MessageReplies: тред комментариев под постом канала.
	Replies *MessageReplies `json:"replies,omitempty"`
	// EditDate — flags.15?int: время правки. У нас это же поле бампится при
	// каждом обновлении живой геолокации — два смысла на одну колонку;
	// разделить их — работа шага витрин, здесь названо.
	EditDate int `json:"edit_date,omitempty"`
	// GroupedID — flags.17?long: ключ альбома.
	//
	// ДОЛГ, названный явно: у нас это client-generated СТРОКА до 32 символов
	// (messages.grouped_id TEXT), а в схеме — long. Класть нашу строку в поле,
	// которое на фазе 2 станет числом, нельзя: кодек сломался бы молча — ровно
	// та ловушка, из-за которой emoji_status уехал в собственный параметр.
	// Предмет при этом ОДИН и тот же (непрозрачный ключ медиагруппы), никакого
	// «отступления по природе предмета» здесь нет, поэтому тип берётся схемный,
	// а перевод генератора ключа и колонки — работа шага витрин.
	GroupedID int64 `json:"grouped_id,omitempty"`
	// Reactions — flags.20?MessageReactions.
	Reactions *MessageReactions `json:"reactions,omitempty"`
	// TTLPeriod — flags.25?int: самоуничтожение, секунды (messages.ttl_seconds).
	// Инвентарь разбора нашёл, что сегодня срок доезжает до клиента ТОЛЬКО у
	// шифрованных сообщений (выдаётся внутри ветки `if m.EncBody != nil`) — на
	// обычном сообщении он теряется на проводе.
	TTLPeriod int `json:"ttl_period,omitempty"`
	// Effect — НАШ СОБСТВЕННЫЙ параметр вне схемы (решение Р6), объявленный
	// штатным механизмом клиентских полей (schema_additional_params.json,
	// предикат `message`, имя effect_name).
	//
	// Предмет ДРУГОЙ природы: в схеме effect:flags2.2?long — идентификатор
	// документа-эффекта с сервера, у нас же это одно из шести КЛИЕНТСКИХ
	// пресет-имён (fireworks|confetti|hearts|thumbs|poop|cake, sanitize.go:17),
	// рисуемых на canvas. Тот же класс, что тема оформления и признак
	// секретного чата; в схемное поле его класть нельзя по той же причине, что
	// unicode-символ в emoji_status.
	Effect string `json:"effect_name,omitempty"`
	// FactCheck — flags2.3?FactCheck.
	FactCheck *MTFactCheck `json:"factcheck,omitempty"`

	// SendAt/WhenOnline — ОТЛОЖЕННАЯ отправка, наши параметры вне схемы.
	// «Это отложенное» у оригинала выражает клиентский флаг pFlags.is_scheduled
	// (он объявлен в schema_additional_params.json самим tweb), а вот СРОК у
	// оригинала живёт не на сообщении: schedule_date это параметр МЕТОДА
	// отправки, а «когда появится онлайн» — его sentinel-значение. У нас срок
	// хранится строкой scheduled_messages и обязан доехать до списка
	// отложенных, поэтому едет здесь, названным параметром.
	SendAt     int64 `json:"send_at,omitempty"`
	WhenOnline bool  `json:"when_online,omitempty"`

	// RandomID — ключ, которым ОТПРАВИТЕЛЬ матчит эхо со своим оптимистичным
	// баблом. Клиентский параметр самого оригинала (`random_id` у предиката
	// `message` в schema_additional_params.json), а не наша выдумка: у нас он
	// назывался client_msg_id и ехал только в кадре, из-за чего витрина и кадр
	// расходились ещё в одном поле.
	RandomID string `json:"random_id,omitempty"`

	// ── ДОЛГ: объединение MessageMedia не доведено ──────────────────────────
	// Гео, контакт, опрос, чек-лист, розыгрыш, подарок, превью ссылки и платное
	// медиа — это КОНСТРУКТОРЫ ТОГО ЖЕ объединения MessageMedia
	// (messageMediaGeo/GeoLive/Venue/Contact/Poll/ToDo/Giveaway/WebPage/
	// PaidMedia), а у нас они по-прежнему собственные поля сообщения. Предмет в
	// схеме ЕСТЬ — значит это не «названное отступление», а незакрытый долг, и
	// он назван здесь и в сверке витрины со схемой (mediaUnionPending),
	// а не спрятан объявлением клиентского параметра.
	//
	// Довести объединение до них — отдельный шаг: Poll, WebPage и Giveaway сами
	// по себе конструкторы со своими вложенными объединениями (PollResults,
	// PollAnswer, WebPage, TodoList), то есть работа масштаба подсистемы, а не
	// перестановка полей.
	Geo       map[string]any  `json:"geo,omitempty"`
	Contact   map[string]any  `json:"contact,omitempty"`
	Poll      *PollInfo       `json:"poll,omitempty"`
	Checklist *ChecklistInfo  `json:"checklist,omitempty"`
	Giveaway  *GiveawayInfo   `json:"giveaway,omitempty"`
	Gift      *GiftInfo       `json:"gift,omitempty"`
	WebPage   *WebPagePreview `json:"web_page,omitempty"`
	PaidMedia map[string]any  `json:"paid_media,omitempty"`

	// ── Секретные чаты: названное отступление от схемы ──────────────────────
	// Шифрованное сообщение (EncryptedChat) в периметр порта не входит решением
	// от 2026-08-19 — той же строкой, что и dialog.secret. Тела у него нет: на
	// проводе едет блоб iv||ciphertext, а `type == "encrypted"` был третьим
	// вопросом, на который отвечало снятое поле type.
	//
	// Срок самоуничтожения при этом больше НЕ живёт здесь: ttl_period есть в
	// схеме, и он общий для шифрованного и обычного сообщения (прежде он
	// выдавался только внутри ветки шифрованного и на обычном терялся).
	EncBody    string  `json:"enc_body,omitempty"`
	DestructAt *string `json:"destruct_at,omitempty"`
}

func (MessageReal) isMTMessage()  {}
func (m MessageReal) Tag() string { return m.Underscore }

// Out — сообщение отправлено зрителем. Предиката ЗДЕСЬ НЕТ намеренно: решение
// Р7 оставляет `out` клиенту (deriveOut), сервер флага не производит.
// Специально не заводим и метод-обёртку — иначе появился бы второй ответ на
// вопрос, у которого один владелец.

// NewMessage собирает обычное сообщение. Обязательные по схеме параметры — в
// аргументах, остальное присваивается полями (приём NewDialog/NewChannelFull):
// у сообщения необязательных параметров вдесятеро больше, чем обязательных.
func NewMessage(id int64, peer Peer, date time.Time, text string, f MessageFlags) MessageReal {
	m := MessageReal{
		Underscore: MessageTag,
		ID:         id,
		PeerID:     peer,
		Date:       unixSeconds(date),
		Message:    text,
	}
	setPFlag(&m.PFlags, "out", f.Out)
	setPFlag(&m.PFlags, "mentioned", f.Mentioned)
	setPFlag(&m.PFlags, "media_unread", f.MediaUnread)
	setPFlag(&m.PFlags, "post", f.Post)
	setPFlag(&m.PFlags, "pinned", f.Pinned)
	return m
}

// messageService#7a800e0a flags:# out:flags.1?true mentioned:flags.4?true
// media_unread:flags.5?true reactions_are_possible:flags.9?true
// silent:flags.13?true post:flags.14?true legacy:flags.19?true id:int
// from_id:flags.8?Peer peer_id:Peer saved_peer_id:flags.28?Peer
// reply_to:flags.3?MessageReplyHeader date:int action:MessageAction
// reactions:flags.20?MessageReactions ttl_period:flags.25?int = Message;
//
// СЛУЖЕБНОЕ сообщение: пилюля посреди ленты. Текста у него нет вовсе — есть
// action, и это ГЛАВНОЕ расхождение подсистемы: у нас служебное действие едет
// JSON-строкой внутри поля text.
//
// Вместе с JSON уходят три склейки, которые сегодня делает сервер:
//   - имена (`actor`, `user`, `chat` строками рядом с actor_id/user_id) —
//     последний экземпляр display_name, снятого у пиров;
//   - превью закреплённого (msg_id, msg_seq, msg_type, msg_name, msg_text,
//     обрезанный до 100 символов НА СЕРВЕРЕ) — у оригинала
//     messageActionPinMessage не имеет параметров вовсе, цель находится по
//     reply_to, превью строит клиент;
//   - подпись автора темы форума (сегодня служебный текст темы это готовая
//     фраза «Имя создал(а) тему «…»» — даже не JSON).
//
// Из флагов производится только post (см. MessageFlags): mentioned/media_unread
// у пилюли не бывает, reactions_are_possible и legacy предмета не имеют,
// silent — параметр отправки, out считает клиент (решение Р7).
type MessageService struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int64           `json:"id"`
	FromID     Peer            `json:"from_id,omitempty"`
	PeerID     Peer            `json:"peer_id"`
	// ReplyTo — flags.3?MessageReplyHeader. У закрепления это единственный
	// способ узнать цель: параметров у messageActionPinMessage нет.
	ReplyTo *MessageReplyHeader `json:"reply_to,omitempty"`
	Date    int                 `json:"date"`
	// Action — обязательный: сам по себе служебный конструктор без действия
	// смысла не имеет.
	Action MessageAction `json:"action"`
	// TTLPeriod — flags.25?int, тот же предмет, что у message.
	TTLPeriod int `json:"ttl_period,omitempty"`
}

func (MessageService) isMTMessage()  {}
func (m MessageService) Tag() string { return m.Underscore }

// NewMessageService собирает служебное сообщение.
func NewMessageService(id int64, peer Peer, date time.Time, action MessageAction, post bool) MessageService {
	m := MessageService{
		Underscore: MessageServiceTag,
		ID:         id,
		PeerID:     peer,
		Date:       unixSeconds(date),
		Action:     action,
	}
	setPFlag(&m.PFlags, "post", post)
	return m
}

// ── MessageReplyHeader ──────────────────────────────────────────────────────

// MessageReplyHeaderTag — дискриминатор `_` конструктора messageReplyHeader.
const MessageReplyHeaderTag = "messageReplyHeader"

// messageReplyHeader#1b97dd66 flags:# reply_to_scheduled:flags.2?true
// forum_topic:flags.3?true quote:flags.9?true reply_to_ephemeral:flags.13?true
// reply_to_msg_id:flags.4?int reply_to_peer_id:flags.0?Peer
// reply_from:flags.5?MessageFwdHeader reply_media:flags.8?MessageMedia
// reply_to_top_id:flags.1?int quote_text:flags.6?string
// quote_entities:flags.7?Vector<MessageEntity> quote_offset:flags.10?int
// todo_item_id:flags.11?int poll_option:flags.12?bytes = MessageReplyHeader;
//
// ССЫЛКА на отвечаемое сообщение — и только ссылка (решение Р4). У нас на её
// месте ехал СНИМОК: {msg_id, seq, sender_id, text, entities, type, media_id,
// quote_text} — четвёртый экземпляр той же болезни, что уже снята у диалогов,
// пиров и закрепления. Сообщение клиент берёт из своего хранилища.
//
// Схема при этом различает два случая, которые мы смешивали:
//
//   - ЦИТАТА (quote_text/quote_entities/quote_offset) едет ВСЕГДА, когда она
//     есть: выделенный фрагмент нельзя вывести из оригинала, если оригинал
//     потом изменили;
//   - НЕДОСТУПНЫЙ ОРИГИНАЛ (ответ на сообщение из чужого чата) выражается
//     СТРУКТУРАМИ reply_from:MessageFwdHeader и reply_media:MessageMedia, а не
//     плоскими ReplySnapshotName (имя автора строкой) и ReplySnapshotText
//     (текст либо лейбл медиа строкой).
//
// Обязательных параметров у конструктора нет ни одного: пустой
// messageReplyHeader — законная форма («ответ есть, подробностей нет»).
//
// Не производятся (все необязательные, поэтому пропуск бесплатен и на фазе 2):
// reply_to_scheduled (ответ на отложенное), reply_to_ephemeral, todo_item_id и
// poll_option (ответ на пункт чек-листа и на вариант опроса — механики нет).
type MessageReplyHeader struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// ReplyToMsgID — flags.4?int: номер отвечаемого В ЕГО чате (наш seq).
	ReplyToMsgID int64 `json:"reply_to_msg_id,omitempty"`
	// ReplyToPeerID — flags.0?Peer: чат оригинала, когда он ДРУГОЙ. У ответа
	// внутри своего чата параметра нет вовсе.
	ReplyToPeerID Peer `json:"reply_to_peer_id,omitempty"`
	// ReplyFrom — flags.5?MessageFwdHeader: атрибуция автора оригинала, когда
	// сам оригинал зрителю недоступен.
	ReplyFrom *MessageFwdHeader `json:"reply_from,omitempty"`
	// ReplyMedia — flags.8?MessageMedia: вложение недоступного оригинала.
	ReplyMedia *MessageMedia `json:"reply_media,omitempty"`
	// ReplyToTopID — flags.1?int: корень треда (наш ThreadRootID).
	ReplyToTopID int64 `json:"reply_to_top_id,omitempty"`
	// QuoteText/QuoteEntities/QuoteOffset — выделенный фрагмент оригинала и
	// его смещение в плоском тексте (UTF-16).
	QuoteText     string          `json:"quote_text,omitempty"`
	QuoteEntities MessageEntities `json:"quote_entities,omitempty"`
	QuoteOffset   int             `json:"quote_offset,omitempty"`
}

// NewMessageReplyHeader — ответ на сообщение своего чата. Цитата, чужой чат и
// недоступный оригинал присваиваются полями: у конструктора нет ни одного
// обязательного параметра, и перечислять в аргументах восемь необязательных
// значило бы завести восемь способов написать «ничего».
func NewMessageReplyHeader(replyToMsgID int64) MessageReplyHeader {
	return MessageReplyHeader{Underscore: MessageReplyHeaderTag, ReplyToMsgID: replyToMsgID}
}

// Quote отмечает, что ответ несёт выделенный фрагмент (pFlags.quote), и
// заполняет сам фрагмент. Флаг и текст ставятся ОДНИМ вызовом: врозь они
// разъедутся, а «quote без quote_text» — это форма, которую клиент оригинала
// не умеет читать.
func (h *MessageReplyHeader) Quote(text string, entities MessageEntities, offset int) {
	h.QuoteText = text
	h.QuoteEntities = entities
	h.QuoteOffset = offset
	setPFlag(&h.PFlags, "quote", text != "")
}

// ForumTopic — ответ адресует тему форума (pFlags.forum_topic).
func (h *MessageReplyHeader) ForumTopic(on bool) { setPFlag(&h.PFlags, "forum_topic", on) }

// ── MessageReplies ──────────────────────────────────────────────────────────

// MessageRepliesTag — дискриминатор `_` конструктора messageReplies.
const MessageRepliesTag = "messageReplies"

// messageReplies#83d60fc2 flags:# comments:flags.0?true replies:int
// replies_pts:int recent_repliers:flags.1?Vector<Peer> channel_id:flags.0?long
// max_id:flags.2?int read_max_id:flags.3?int = MessageReplies;
//
// ТРЕД КОММЕНТАРИЕВ под постом канала — то, что сегодня едет отдельной ручкой
// `GET /channels/{id}/comment_counts` и отдельной формой {counts,
// recent_repliers}. Предмет есть целиком: счёт даёт CountThread, авторов —
// RecentThreadRepliers, группу обсуждения — GetDiscussion.
//
// Заодно чинится ещё одна серверная склейка: сегодня recent_repliers едет
// вектором ПОЛНЫХ карточек пользователя, вклеенных прямо в ответ ручки. В
// схеме это Vector<Peer> — только ссылки, а карточки едут своим вектором
// users, как у диалогов после порта.
//
// Не производятся:
//   - replies_pts (ОБЯЗАТЕЛЬНЫЙ) — отдельного журнала апдейтов у треда нет:
//     pts у нас на чат, а не на тред. На фазе 2 станет заглушкой-нулём в
//     потоке (tl-program.md, «нет предмета перестаёт быть бесплатным»);
//   - max_id/read_max_id — горизонта чтения ВНУТРИ треда мы не храним:
//     прочитанность считается по чату обсуждения целиком.
type MessageReplies struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// Replies — обязательный: число комментариев, едет и нулевым.
	Replies int `json:"replies"`
	// RecentRepliers — flags.1?Vector<Peer>: до трёх последних комментаторов
	// (RecentRepliersLimit) под стек аватаров в футере поста.
	RecentRepliers []Peer `json:"recent_repliers,omitempty"`
	// ChannelID — flags.0?long: id ГРУППЫ ОБСУЖДЕНИЯ, где живёт тред. Делит
	// бит с pFlags.comments — у оригинала они всегда парой.
	ChannelID int64 `json:"channel_id,omitempty"`
}

// NewMessageReplies — тред комментариев поста канала. Флаг comments и
// channel_id ставятся вместе: в схеме они делят один бит, и порознь такой
// объект не соберётся.
func NewMessageReplies(replies int, discussionChatID int64, recent []Peer) MessageReplies {
	r := MessageReplies{
		Underscore:     MessageRepliesTag,
		Replies:        replies,
		RecentRepliers: recent,
		ChannelID:      discussionChatID,
	}
	setPFlag(&r.PFlags, "comments", discussionChatID != 0)
	return r
}

// ── MessageAction ───────────────────────────────────────────────────────────

// MessageAction — объединение схемы: 67 конструкторов, из которых мы
// производим тринадцать. Соответствие «наше действие → конструктор схемы»
// задано ОДИН раз в таблице действий разбора
// (docs/readiness/tl-message-analysis.md), и повторять его здесь незачем —
// каждый конструктор ниже назван её строкой.
//
// Синтетических конструкторов тут нет и быть не должно: см. шапку файла.
type MessageAction interface {
	isMessageAction()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// Значения дискриминатора `_` объединения MessageAction.
const (
	MessageActionChatCreateTag            = "messageActionChatCreate"
	MessageActionChatEditTitleTag         = "messageActionChatEditTitle"
	MessageActionChatEditPhotoTag         = "messageActionChatEditPhoto"
	MessageActionChatAddUserTag           = "messageActionChatAddUser"
	MessageActionChatDeleteUserTag        = "messageActionChatDeleteUser"
	MessageActionChatJoinedByLinkTag      = "messageActionChatJoinedByLink"
	MessageActionPinMessageTag            = "messageActionPinMessage"
	MessageActionSetMessagesTTLTag        = "messageActionSetMessagesTTL"
	MessageActionTopicCreateTag           = "messageActionTopicCreate"
	MessageActionSuggestProfilePhotoTag   = "messageActionSuggestProfilePhoto"
	MessageActionSuggestedPostApprovalTag = "messageActionSuggestedPostApproval"
	MessageActionPhoneCallTag             = "messageActionPhoneCall"
	MessageActionRestrictTag              = "messageActionRestrict"
)

// messageActionChatCreate#bd47cbad title:string users:Vector<long> = MessageAction;
//
// Наше `group_create`. Оба параметра обязательные и предмет у обоих есть:
// title — название на момент создания, users — список тех, кого создатель
// позвал сразу (CreateGroup их и добавляет).
type MessageActionChatCreate struct {
	Underscore string  `json:"_"`
	Title      string  `json:"title"`
	Users      []int64 `json:"users"`
}

func (MessageActionChatCreate) isMessageAction() {}
func (a MessageActionChatCreate) Tag() string    { return a.Underscore }

func NewMessageActionChatCreate(title string, users []int64) MessageActionChatCreate {
	return MessageActionChatCreate{Underscore: MessageActionChatCreateTag, Title: title, Users: orEmpty(users)}
}

// messageActionChatEditTitle#b5a1ce5a title:string = MessageAction;
//
// Наше `edit_title`. Сегодня НОВОГО НАЗВАНИЯ в действии нет вовсе — едет один
// actor_id, и пилюля читается «Имя изменил(а) название группы» без названия.
type MessageActionChatEditTitle struct {
	Underscore string `json:"_"`
	Title      string `json:"title"`
}

func (MessageActionChatEditTitle) isMessageAction() {}
func (a MessageActionChatEditTitle) Tag() string    { return a.Underscore }

func NewMessageActionChatEditTitle(title string) MessageActionChatEditTitle {
	return MessageActionChatEditTitle{Underscore: MessageActionChatEditTitleTag, Title: title}
}

// messageActionChatEditPhoto#7fcb13a8 photo:Photo = MessageAction;
//
// Наше `edit_photo`. Новая аватарка едет ВНУТРИ действия конструктором photo
// (mtmedia.go), а не полем media_id рядом с ним: сегодня она сидит на
// media_id самого служебного сообщения, то есть в поле, которого у
// messageService в схеме нет вовсе.
type MessageActionChatEditPhoto struct {
	Underscore string `json:"_"`
	Photo      *Photo `json:"photo"`
}

func (MessageActionChatEditPhoto) isMessageAction() {}
func (a MessageActionChatEditPhoto) Tag() string    { return a.Underscore }

func NewMessageActionChatEditPhoto(photo *Photo) MessageActionChatEditPhoto {
	return MessageActionChatEditPhoto{Underscore: MessageActionChatEditPhotoTag, Photo: photo}
}

// messageActionChatAddUser#15cefd00 users:Vector<long> = MessageAction;
//
// Наше `add_user` — ТОЛЬКО идентификаторы, имя собирает клиент. Вектор, а не
// одно число: оригинал умеет добавить нескольких за раз, и клиент уточняет
// этот конструктор до ChatJoined/ChatReturn/ChatAddUsers сам.
type MessageActionChatAddUser struct {
	Underscore string  `json:"_"`
	Users      []int64 `json:"users"`
}

func (MessageActionChatAddUser) isMessageAction() {}
func (a MessageActionChatAddUser) Tag() string    { return a.Underscore }

func NewMessageActionChatAddUser(users []int64) MessageActionChatAddUser {
	return MessageActionChatAddUser{Underscore: MessageActionChatAddUserTag, Users: orEmpty(users)}
}

// messageActionChatDeleteUser#a43f30cc user_id:long = MessageAction;
//
// Наши `kick_user` И `leave` — ОДИН конструктор. Различие выводит клиент: если
// from_id сообщения совпал с user_id, человек вышел сам. Сервер сообщает факт,
// формулировку выбирает клиент (см. шапку файла).
type MessageActionChatDeleteUser struct {
	Underscore string `json:"_"`
	UserID     int64  `json:"user_id"`
}

func (MessageActionChatDeleteUser) isMessageAction() {}
func (a MessageActionChatDeleteUser) Tag() string    { return a.Underscore }

func NewMessageActionChatDeleteUser(userID int64) MessageActionChatDeleteUser {
	return MessageActionChatDeleteUser{Underscore: MessageActionChatDeleteUserTag, UserID: userID}
}

// messageActionChatJoinedByLink#031224c3 inviter_id:long = MessageAction;
//
// Наше `joined_by_link`. Внимание на смену смысла: у нас в действии едет
// actor_id — ВОШЕДШИЙ, а в схеме inviter_id — тот, кто ССЫЛКУ СОЗДАЛ (вошедший
// же и так известен: он from_id сообщения). Предмет есть — у строки инвайта
// хранится создатель.
type MessageActionChatJoinedByLink struct {
	Underscore string `json:"_"`
	InviterID  int64  `json:"inviter_id"`
}

func (MessageActionChatJoinedByLink) isMessageAction() {}
func (a MessageActionChatJoinedByLink) Tag() string    { return a.Underscore }

func NewMessageActionChatJoinedByLink(inviterID int64) MessageActionChatJoinedByLink {
	return MessageActionChatJoinedByLink{Underscore: MessageActionChatJoinedByLinkTag, InviterID: inviterID}
}

// messageActionPinMessage#94bd38ed = MessageAction;
//
// Наше `pin_message` — и у него НЕТ НИ ОДНОГО ПАРАМЕТРА. Сегодня оно несёт
// msg_id, msg_seq, msg_type, msg_name и msg_text, обрезанный до 100 символов
// НА СЕРВЕРЕ; всё это уходит. Цель закрепления — reply_to самого служебного
// сообщения, превью строит клиент той же wrapMessageForReply, что рисует
// цитату ответа и строку списка чатов.
type MessageActionPinMessage struct {
	Underscore string `json:"_"`
}

func (MessageActionPinMessage) isMessageAction() {}
func (a MessageActionPinMessage) Tag() string    { return a.Underscore }

func NewMessageActionPinMessage() MessageActionPinMessage {
	return MessageActionPinMessage{Underscore: MessageActionPinMessageTag}
}

// messageActionSetMessagesTTL#3c134d7b flags:# period:int
// auto_setting_from:flags.0?long = MessageAction;
//
// Наше `set_ttl`. Period в секундах, 0 — автоудаление выключено.
// auto_setting_from (кто включил автоудаление глобальной настройкой) предмета
// не имеет: глобальной настройки автоудаления у нас нет.
type MessageActionSetMessagesTTL struct {
	Underscore string `json:"_"`
	Period     int    `json:"period"`
}

func (MessageActionSetMessagesTTL) isMessageAction() {}
func (a MessageActionSetMessagesTTL) Tag() string    { return a.Underscore }

func NewMessageActionSetMessagesTTL(period int) MessageActionSetMessagesTTL {
	return MessageActionSetMessagesTTL{Underscore: MessageActionSetMessagesTTLTag, Period: period}
}

// messageActionTopicCreate#0d999256 flags:# title_missing:flags.1?true
// title:string icon_color:int icon_emoji_id:flags.0?long = MessageAction;
//
// Создание темы форума. Сегодня это ЕДИНСТВЕННОЕ служебное сообщение, чей
// текст даже не JSON, а готовая русская фраза со вклеенным именем автора
// («%s создал(а) тему «%s»») — то есть склейка имени в самом чистом виде.
//
// icon_emoji_id не производится: в схеме это document_id кастом-эмодзи, а у
// нас иконка темы — unicode-символ (forum_topics.icon_emoji), тот же случай,
// что emoji_status у пира. Параметр необязательный, поэтому пропуск бесплатен;
// сама иконка едет строкой темы, а не действием. title_missing предмета не
// имеет: тема без названия у нас невозможна.
type MessageActionTopicCreate struct {
	Underscore string `json:"_"`
	Title      string `json:"title"`
	IconColor  int    `json:"icon_color"`
}

func (MessageActionTopicCreate) isMessageAction() {}
func (a MessageActionTopicCreate) Tag() string    { return a.Underscore }

func NewMessageActionTopicCreate(title string, iconColor int) MessageActionTopicCreate {
	return MessageActionTopicCreate{Underscore: MessageActionTopicCreateTag, Title: title, IconColor: iconColor}
}

// messageActionSuggestProfilePhoto#57de635e photo:Photo = MessageAction;
//
// Наше `suggest_photo`. Photo — предложенная аватарка (сегодня её id ехал и в
// JSON действия, и на media_id сообщения — два места на одно значение).
//
// Accepted — НАШ СОБСТВЕННЫЙ параметр вне схемы, объявленный штатным
// механизмом (schema_additional_params.json, предикат
// messageActionSuggestProfilePhoto). Предмета в схеме у него нет: у оригинала
// принятое предложение видно по тому, что фото стало аватаркой, а у нас
// признак хранится на самом действии и по нему клиент прячет кнопку
// «Установить фото» на ВСЕХ устройствах разом (data.ts:60).
type MessageActionSuggestProfilePhoto struct {
	Underscore string `json:"_"`
	Photo      *Photo `json:"photo"`
	Accepted   bool   `json:"accepted,omitempty"`
}

func (MessageActionSuggestProfilePhoto) isMessageAction() {}
func (a MessageActionSuggestProfilePhoto) Tag() string    { return a.Underscore }

func NewMessageActionSuggestProfilePhoto(photo *Photo, accepted bool) MessageActionSuggestProfilePhoto {
	return MessageActionSuggestProfilePhoto{
		Underscore: MessageActionSuggestProfilePhotoTag, Photo: photo, Accepted: accepted,
	}
}

// messageActionSuggestedPostApproval#ee7a1596 flags:# rejected:flags.0?true
// balance_too_low:flags.1?true reject_comment:flags.2?string
// schedule_date:flags.3?int price:flags.4?StarsAmount = MessageAction;
//
// Наши `suggest_post_approved` и `suggest_post_rejected` — ОДИН конструктор,
// решение выражает pFlags.rejected.
//
// ── channel_id: НАШ параметр вне схемы ──────────────────────────────────────
// У оригинала канал называть незачем: пилюля лежит В САМОМ КАНАЛЕ, то есть
// канал — это peer_id сообщения. У нас решение приходит автору в чат с
// СЕРВИСНЫМ аккаунтом, поэтому peer_id указывает на сервисный аккаунт, а не на
// канал, и без отдельного параметра фраза вырождается в «ваш пост одобрен» без
// ответа на вопрос «где».
//
// Едет ССЫЛКА, а не название: имя канала соберёт клиент из карточки пира — тот
// самый урок, который стоил дефекта «Пользователь добавил(а) пользователя»
// (прежний вариант вёз `chat` строкой).
//
// Не производятся: balance_too_low, reject_comment, schedule_date и price —
// платной предложки постов (Stars) у нас нет.
type MessageActionSuggestedPostApproval struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ChannelID  int64           `json:"channel_id,omitempty"`
}

func (MessageActionSuggestedPostApproval) isMessageAction() {}
func (a MessageActionSuggestedPostApproval) Tag() string    { return a.Underscore }

// NewMessageActionSuggestedPostApproval — решение по предложке. channelID —
// внутренний id канала; наружу он уходит знаковым ключом пира, как везде.
func NewMessageActionSuggestedPostApproval(rejected bool, channelID int64) MessageActionSuggestedPostApproval {
	a := MessageActionSuggestedPostApproval{
		Underscore: MessageActionSuggestedPostApprovalTag,
		ChannelID:  int64(ToPeerID(channelID, true)),
	}
	setPFlag(&a.PFlags, "rejected", rejected)
	return a
}

// messageActionPhoneCall#80e11a7f flags:# video:flags.2?true call_id:long
// reason:flags.0?PhoneCallDiscardReason duration:flags.1?int = MessageAction;
//
// Лог звонка. Сегодня это сообщение с `type == 'call'`, чей text — JSON
// {video, reason, duration}, то есть та же подделка дискриминатора, что у
// служебных действий, но в другом поле.
//
// call_id (ОБЯЗАТЕЛЬНЫЙ) не производится: идентификатор звонка у нас — uuid,
// живущий только в сигнальных кадрах (callEngine), на сообщение он не
// сохраняется. На фазе 2 станет заглушкой-нулём в потоке.
//
// Наши четыре причины ложатся на схему так: `missed` → Missed, `busy` → Busy,
// `ok` и `cancelled` → ОДИН Hangup, различаемые НАЛИЧИЕМ duration. Именно так
// читает оригинал (у соединившегося звонка есть длительность, у сорвавшегося
// нет), и лишнего конструктора для этого не нужно.
type MessageActionPhoneCall struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// Reason — flags.0?PhoneCallDiscardReason: почему звонок кончился.
	Reason PhoneCallDiscardReason `json:"reason,omitempty"`
	// Duration — flags.1?int: секунды разговора. Отсутствует, когда соединения
	// не случилось, и именно отсутствие отличает «отменён» от «состоялся».
	Duration int `json:"duration,omitempty"`
}

func (MessageActionPhoneCall) isMessageAction() {}
func (a MessageActionPhoneCall) Tag() string    { return a.Underscore }

// NewMessageActionPhoneCall — лог звонка. Нулевая duration означает «соединения
// не было» и ключа не даёт: это не «разговор длиной ноль».
func NewMessageActionPhoneCall(video bool, reason PhoneCallDiscardReason, duration int) MessageActionPhoneCall {
	a := MessageActionPhoneCall{Underscore: MessageActionPhoneCallTag, Reason: reason, Duration: duration}
	setPFlag(&a.PFlags, "video", video)
	return a
}

// messageActionRestrict#d1500001 user_id:long banned_rights:ChatBannedRights = MessageAction;
//
// НАШ СОБСТВЕННЫЙ конструктор: предмета в схеме у него НЕТ. Ограничение прав
// участника у оригинала вообще не порождает сообщения в ленте — оно уходит в
// журнал администратора (channelAdminLogEventActionParticipantToggleBan), а
// журнала у нас нет; пилюля «X ограничил(а) права Y» при этом живая и
// показывается (serviceMsg.ts:107).
//
// Объявлен в собственном пространстве — записью с полем `type` в
// schema/schema_additional_params.json (тот же штатный механизм оригинала, что
// у dialog.secret), а не подмешан в чужой конструктор: сверщик обязан видеть,
// что это НАШ предикат, а кодек фазы 2 — что число id назначено нами.
//
// Про число: правило «id = CRC32 канонической строки» воспроизводится не
// полностью (tl-program.md), поэтому своим конструкторам id назначается ЯВНО.
// Взят блок d150xxxx, во всей схеме (и API, и MTProto, конструкторы и методы)
// не занятый ни одним числом; незанятость проверяется тестом, а не на слово.
//
// Содержимое действия — сам набор запретов, и он берётся уже портированным
// chatBannedRights (mtchat.go), а не вторым битмаском рядом: сегодня в JSON
// едет `denied_rights` числом, которого не читает ни один клиент, и срок
// ограничения не едет вовсе — хотя хранится (MemberRestriction.UntilDate).
// В chatBannedRights оба помещаются штатно: запреты — в pFlags, срок — в
// until_date.
type MessageActionRestrict struct {
	Underscore   string           `json:"_"`
	UserID       int64            `json:"user_id"`
	BannedRights ChatBannedRights `json:"banned_rights"`
}

func (MessageActionRestrict) isMessageAction() {}
func (a MessageActionRestrict) Tag() string    { return a.Underscore }

func NewMessageActionRestrict(userID int64, rights ChatBannedRights) MessageActionRestrict {
	return MessageActionRestrict{Underscore: MessageActionRestrictTag, UserID: userID, BannedRights: rights}
}

// ── PhoneCallDiscardReason ──────────────────────────────────────────────────

// PhoneCallDiscardReason — объединение схемы: phoneCallDiscardReasonMissed |
// phoneCallDiscardReasonBusy | phoneCallDiscardReasonDisconnect |
// phoneCallDiscardReasonHangup | phoneCallDiscardReasonMigrateConferenceCall.
//
// Производим три — ровно те, у которых есть предмет (см. MessageActionPhoneCall).
// Disconnect (обрыв связи) наш движок от «отменён» не отличает, а
// MigrateConferenceCall — переход в групповой звонок, которого у нас нет.
type PhoneCallDiscardReason interface {
	isPhoneCallDiscardReason()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// Значения дискриминатора `_` объединения PhoneCallDiscardReason.
const (
	PhoneCallDiscardReasonMissedTag = "phoneCallDiscardReasonMissed"
	PhoneCallDiscardReasonBusyTag   = "phoneCallDiscardReasonBusy"
	PhoneCallDiscardReasonHangupTag = "phoneCallDiscardReasonHangup"
)

// phoneCallDiscardReasonMissed#85e42301 = PhoneCallDiscardReason;
//
// Не ответили — наш `missed`.
type PhoneCallDiscardReasonMissed struct {
	Underscore string `json:"_"`
}

func (PhoneCallDiscardReasonMissed) isPhoneCallDiscardReason() {}
func (r PhoneCallDiscardReasonMissed) Tag() string             { return r.Underscore }

func NewPhoneCallDiscardReasonMissed() PhoneCallDiscardReasonMissed {
	return PhoneCallDiscardReasonMissed{Underscore: PhoneCallDiscardReasonMissedTag}
}

// phoneCallDiscardReasonBusy#faf7e8c9 = PhoneCallDiscardReason;
//
// Занято либо отклонено — наш `busy` (включая отказ по правилу приватности).
type PhoneCallDiscardReasonBusy struct {
	Underscore string `json:"_"`
}

func (PhoneCallDiscardReasonBusy) isPhoneCallDiscardReason() {}
func (r PhoneCallDiscardReasonBusy) Tag() string             { return r.Underscore }

func NewPhoneCallDiscardReasonBusy() PhoneCallDiscardReasonBusy {
	return PhoneCallDiscardReasonBusy{Underscore: PhoneCallDiscardReasonBusyTag}
}

// phoneCallDiscardReasonHangup#57adc690 = PhoneCallDiscardReason;
//
// Положили трубку — наши `ok` И `cancelled` сразу. Различает их duration:
// состоявшийся разговор её несёт, отменённый — нет.
type PhoneCallDiscardReasonHangup struct {
	Underscore string `json:"_"`
}

func (PhoneCallDiscardReasonHangup) isPhoneCallDiscardReason() {}
func (r PhoneCallDiscardReasonHangup) Tag() string             { return r.Underscore }

func NewPhoneCallDiscardReasonHangup() PhoneCallDiscardReasonHangup {
	return PhoneCallDiscardReasonHangup{Underscore: PhoneCallDiscardReasonHangupTag}
}

// ── MessageReactions ────────────────────────────────────────────────────────

// Дискриминаторы `_` подсистемы реакций сообщения.
const (
	MessageReactionsTag    = "messageReactions"
	ReactionCountTag       = "reactionCount"
	ReactionPaidTag        = "reactionPaid"
	MessagePeerReactionTag = "messagePeerReaction"
)

// messageReactions#0a339f0b flags:# min:flags.0?true can_see_list:flags.2?true
// reactions_as_tags:flags.3?true results:Vector<ReactionCount>
// recent_reactions:flags.1?Vector<MessagePeerReaction>
// top_reactors:flags.4?Vector<MessageReactor> = MessageReactions;
//
// Агрегаты реакций сообщения. У нас это плоский срез ReactionCount{emoji,
// count, mine, recent} прямо на строке витрины; в схеме — вложенный объект, где
// «кто именно поставил» вынесено отдельным вектором messagePeerReaction, и
// потому не дублируется в каждом чипе.
//
// Не производятся: min (объект пришёл урезанным — двух степеней полноты у нас
// нет), can_see_list (список реагировавших у нас виден всегда), reactions_as_tags
// (теги сохранённых сообщений), top_reactors (доска платных реакций).
type MessageReactions struct {
	Underscore string `json:"_"`
	// Results — обязательный: чипы с числами. Едет пустым вектором, а не null.
	Results []MTReactionCount `json:"results"`
	// RecentReactions — flags.1?Vector<MessagePeerReaction>: кто поставил, до
	// трёх последних. Клиент показывает их аватары вместо числа при count<4.
	RecentReactions []MessagePeerReaction `json:"recent_reactions,omitempty"`
	// TopReactors — flags.4?Vector<MessageReactor>: доска ПЛАТНЫХ ⭐-реакций.
	// Здесь живёт личный вклад зрителя: в reactionCount помещается только «моя
	// или не моя», а число отданных звёзд — это count у messageReactor с
	// pFlags.my. Прежде пара {total, mine} ехала отдельным ключом star_reaction
	// рядом с обычными чипами.
	TopReactors []MessageReactor `json:"top_reactors,omitempty"`
}

// NewMessageReactions — агрегаты реакций сообщения.
func NewMessageReactions(results []MTReactionCount, recent []MessagePeerReaction) MessageReactions {
	return MessageReactions{
		Underscore:      MessageReactionsTag,
		Results:         orEmpty(results),
		RecentReactions: recent,
	}
}

// reactionCount#a3d1cb80 flags:# chosen_order:flags.0?int reaction:Reaction
// count:int = ReactionCount;
//
// ОДИН чип: какая реакция и сколько её. Имя структуры с префиксом MT —
// `ReactionCount` в пакете занято плоской строкой витрины (domain/reaction.go),
// которая живёт ещё один шаг; приём тот же, что у MTMessage.
//
// Наш `mine bool` — это chosen_order: у оригинала не «поставил/не поставил», а
// ПОРЯДКОВЫЙ НОМЕР среди моих реакций на этом сообщении (их бывает несколько).
// «Не поставил» выражается ОТСУТСТВИЕМ параметра, поэтому поле — указатель:
// chosen_order = 0 значит «моя первая», и с «не моя» его склеивать нельзя.
type MTReactionCount struct {
	Underscore  string   `json:"_"`
	ChosenOrder *int     `json:"chosen_order,omitempty"`
	Reaction    Reaction `json:"reaction"`
	Count       int      `json:"count"`
}

// NewReactionCount — чип реакции. mine=true даёт chosen_order = 0: несколькими
// своими реакциями на одно сообщение мы не оперируем, но ноль это ЗНАЧЕНИЕ, а
// не отсутствие, и разница видна на проводе.
func NewReactionCount(reaction Reaction, count int, mine bool) MTReactionCount {
	c := MTReactionCount{Underscore: ReactionCountTag, Reaction: reaction, Count: count}
	if mine {
		zero := 0
		c.ChosenOrder = &zero
	}
	return c
}

// reactionPaid#523da4eb = Reaction;
//
// ПЛАТНАЯ ⭐-реакция — наши star_reactions. Второй конструктор объединения
// Reaction: само объединение и reactionEmoji объявлены в mtchat.go (там их
// потребовал chatReactionsSome), и переезжать они будут в подсистему реакций
// целиком, а не по одному. reactionCustomEmoji не объявляется: кастом-эмодзи у
// нас нет (тот же случай, что emoji_status у пира).
type ReactionPaid struct {
	Underscore string `json:"_"`
}

func (ReactionPaid) isReaction()   {}
func (r ReactionPaid) Tag() string { return r.Underscore }

func NewReactionPaid() ReactionPaid {
	return ReactionPaid{Underscore: ReactionPaidTag}
}

// messagePeerReaction#8c79b63c flags:# big:flags.0?true unread:flags.1?true
// my:flags.2?true peer_id:Peer date:int reaction:Reaction = MessagePeerReaction;
//
// КТО поставил реакцию — ссылкой на пир, а не мини-карточкой {id, name,
// avatar}, которую сегодня вклеивает в jsonb прямо SQL-запрос. Это была третья
// форма пользователя на проводе, и разъезжалась она с остальными сама по себе.
//
// Не производятся: big («крупная» анимация отправителя), unread (непрочитанной
// считается реакция в целом по чату, счётчик живёт на диалоге), my — его
// клиент выводит сам из peer_id, ровно как pFlags.out (решение Р7).
type MessagePeerReaction struct {
	Underscore string   `json:"_"`
	PeerID     Peer     `json:"peer_id"`
	Date       int      `json:"date"`
	Reaction   Reaction `json:"reaction"`
}

func NewMessagePeerReaction(peer Peer, date time.Time, reaction Reaction) MessagePeerReaction {
	return MessagePeerReaction{
		Underscore: MessagePeerReactionTag,
		PeerID:     peer,
		Date:       unixSeconds(date),
		Reaction:   reaction,
	}
}

// MessageReactorTag — дискриминатор `_` конструктора messageReactor.
const MessageReactorTag = "messageReactor"

// messageReactor#4ba3a95a flags:# top:flags.0?true my:flags.1?true
// anonymous:flags.2?true peer_id:flags.3?Peer count:int = MessageReactor;
//
// Один отправитель ПЛАТНОЙ ⭐-реакции и его вклад. У нас это две разные
// витрины: `star_reaction.mine` на самом сообщении и отдельная ручка
// топ-отправителей (GET .../star_reaction), где карточка пользователя ехала
// плоско рядом с числом звёзд.
//
// Не производится top («в тройке лидеров»): порядок задаёт сам вектор.
type MessageReactor struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// PeerID — flags.3?Peer: кто отправил. У анонимного отправителя ключа нет
	// вовсе — это и есть pFlags.anonymous, а не пустая карточка рядом с ним.
	PeerID Peer `json:"peer_id,omitempty"`
	Count  int  `json:"count"`
}

// NewMessageReactor — вклад одного отправителя. peer == nil означает
// анонимного: личность не раскрывается, и флаг ставится по тому же признаку.
func NewMessageReactor(peer Peer, count int, my bool) MessageReactor {
	r := MessageReactor{Underscore: MessageReactorTag, PeerID: peer, Count: count}
	setPFlag(&r.PFlags, "my", my)
	setPFlag(&r.PFlags, "anonymous", peer == nil)
	return r
}

// NewMyMessageReactor — вклад САМОГО ЗРИТЕЛЯ. Ссылки на пир здесь нет
// намеренно: «мой» вклад адресован тому, кто читает ответ, и второй раз
// называть его именем незачем — ровно как out, который зритель выводит сам.
func NewMyMessageReactor(count int) MessageReactor {
	r := MessageReactor{Underscore: MessageReactorTag, Count: count}
	setPFlag(&r.PFlags, "my", true)
	return r
}

// ── FactCheck ───────────────────────────────────────────────────────────────

// Дискриминаторы `_` проверки фактов.
const (
	FactCheckTag        = "factCheck"
	TextWithEntitiesTag = "textWithEntities"
)

// factCheck#b89bfccf flags:# need_check:flags.0?true country:flags.1?string
// text:flags.1?TextWithEntities hash:long = FactCheck;
//
// «Проверка фактов» на посте. Имя структуры с префиксом MT — `FactCheck` в
// пакете занято плоской записью витрины (domain/message.go), которая живёт ещё
// один шаг.
//
// Текст с разметкой едет ОДНИМ объектом textWithEntities, а не парой полей
// {text, entities} рядом: в схеме связка «строка + её сущности» именована, и
// именно она же лежит в цитатах, переводах и описаниях.
//
// Не производятся:
//   - hash (ОБЯЗАТЕЛЬНЫЙ) — хэш для кэширования запроса; хэш-кэширования
//     запросов у нас нет вовсе (тот же случай, что messages.dialogsNotModified
//     у диалогов). На фазе 2 станет заглушкой-нулём в потоке;
//   - need_check («проверка ещё идёт») — состояния «в процессе» у нас нет:
//     проверку ставит и снимает автор канала одним действием.
//
// country и text делят один бит (flags.1) — у оригинала они едут парой.
type MTFactCheck struct {
	Underscore string `json:"_"`
	// Country — код страны ISO-3166 alpha-2.
	Country string `json:"country,omitempty"`
	// Text — flags.1?TextWithEntities.
	Text *TextWithEntities `json:"text,omitempty"`
}

func NewFactCheck(country string, text *TextWithEntities) MTFactCheck {
	return MTFactCheck{Underscore: FactCheckTag, Country: country, Text: text}
}

// textWithEntities#751f3146 text:string entities:Vector<MessageEntity> =
// TextWithEntities;
//
// Строка вместе со своей разметкой. Оба параметра обязательные: пустой вектор
// сущностей едет как [], а не отсутствием ключа.
type TextWithEntities struct {
	Underscore string          `json:"_"`
	Text       string          `json:"text"`
	Entities   MessageEntities `json:"entities"`
}

func NewTextWithEntities(text string, entities MessageEntities) *TextWithEntities {
	if entities == nil {
		entities = MessageEntities{}
	}
	return &TextWithEntities{Underscore: TextWithEntitiesTag, Text: text, Entities: entities}
}
