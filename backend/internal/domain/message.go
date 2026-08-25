package domain

import "time"

// Разметка сообщения — объединение конструкторов схемы TL, см. mtentity.go.

// FactCheck — «проверка фактов» на сообщении (Telegram factCheck): пояснение
// админа/модератора (в нашем клоне — автора/админа канала) к посту. Хранится на
// сообщении jsonb-полем (messages.factcheck); nil — проверки нет. Country — код
// страны ISO-3166 alpha-2 (опционально), Entities — форматирование текста.
type FactCheck struct {
	Text     string          `json:"text"`
	Entities MessageEntities `json:"entities,omitempty"`
	Country  string          `json:"country,omitempty"`
}

// WebPagePreview — серверный снимок превью ссылки (Telegram webPage):
// og-теги первой http/https-ссылки текстового сообщения. Хранится на
// сообщении как jsonb (сообщение несёт снимок, кэш не нужен).
type WebPagePreview struct {
	URL         string `json:"url"`
	SiteName    string `json:"site_name,omitempty"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	// ImageURL — адрес og:image на ЧУЖОМ хосте. Транзитное поле: живёт только
	// между разбором страницы и загрузкой картинки к нам (см. PhotoID), наружу
	// не уходит и в jsonb не сохраняется — `json:"-"`. Отдать его клиенту
	// значило бы, что браузер каждого участника чата сам сходит на i.ytimg.com
	// и сдаст свой IP владельцу ссылки; Telegram так не делает — картинку
	// проксирует сервер. Наш CSP (`img-src 'self' data: blob:`) такой запрос и
	// так режет, поэтому раньше карточка показывала битую иконку.
	ImageURL string `json:"-"`
	// PhotoID — картинка превью, УЖЕ скачанная к нам обычным медиа (та же
	// дорога, что у фото сообщения: объект в MinIO, фоновая обработка даёт
	// размеры/thumb/stripped-превью). 0 — картинки нет или скачать не вышло.
	PhotoID int64 `json:"photo_id,omitempty"`
	// Размеры/подложка/наличие thumb — read-model: заполняются на чтении из
	// строки media (hydrateMedia), а не хранятся в jsonb: обработка медиа
	// асинхронная и на момент записи превью их ещё нет.
	PhotoW        int    `json:"photo_w,omitempty"`
	PhotoH        int    `json:"photo_h,omitempty"`
	PhotoBlur     []byte `json:"photo_blur,omitempty"`
	PhotoHasThumb bool   `json:"photo_has_thumb,omitempty"`
	// HasIV — из страницы извлеклась статья Instant View. tweb рисует футер
	// карточки только при `webPage.cached_page` (bubbles.ts:7990), поэтому без
	// этого флага кнопка «Мгновенный просмотр» висела бы на каждой ссылке.
	HasIV bool `json:"has_iv,omitempty"`
}

type Message struct {
	ID     int64
	ChatID int64
	Seq    int64
	// SenderID — автор строки. На проводе это from_id:Peer, и отправка от имени
	// канала (SendAsChatID) там его ЗАМЕЩАЕТ: в схеме отображаемый автор и есть
	// from_id, отдельного снимка send_as рядом с настоящим отправителем не
	// бывает.
	SenderID int64
	// Type — вид строки. ВНУТРЕННЕЕ поле: по нему стоят выборки shared media,
	// журнал звонков и санитизация, но на провод оно не выходит (решение Р2).
	// Вид вложения даёт объединение MessageMedia, «служебное ли» — выбор
	// конструктора (Action != nil), «шифрованное ли» — EncBody.
	Type string
	// Action — СЛУЖЕБНОЕ действие (schema messageService.action), колонка
	// messages.action. Не nil — сообщение служебное, и на проводе это
	// messageService, а не message. Прежде действие ехало JSON-строкой внутри
	// Text, и клиент опознавал его по `raw.startsWith('{')`.
	Action       MessageAction
	Text         string
	Entities     MessageEntities // rich-text formatting spans over Text (nil when plain)
	ReplyToID    *int64
	MediaID      *int64
	ClientMsgID  *string
	ThreadRootID *int64
	// GroupedID — идентификатор медиагруппы (Telegram grouped_id): сообщения
	// одного альбома несут общий id, клиент рендерит их одним грид-баблом.
	// В схеме это flags.17?long — число, а не строка: непрозрачный ключ группы
	// генерирует отправитель (миграция 0105 перевела колонку и старые значения).
	GroupedID *int64
	// PollID — опрос сообщения типа 'poll' (messages.poll_id); Poll — его
	// развёрнутое представление для зрителя, наполняется read-моделью истории.
	PollID *int64
	Poll   *PollInfo
	// ChecklistID — чек-лист сообщения типа 'checklist' (messages.checklist_id);
	// Checklist — его развёрнутое представление, наполняется read-моделью истории.
	ChecklistID *int64
	Checklist   *ChecklistInfo
	// GiveawayID — розыгрыш сообщения типа 'giveaway' (messages.giveaway_id);
	// Giveaway — его представление для зрителя, наполняется read-моделью истории.
	GiveawayID *int64
	Giveaway   *GiveawayInfo
	CreatedAt  time.Time
	Deleted    bool
	EditedAt   *time.Time
	// Forward attribution (set when the message was forwarded from elsewhere).
	FwdFromUserID *int64
	FwdFromChatID *int64
	FwdFromMsgID  *int64
	FwdDate       *time.Time
	// FwdFromName — скрытая атрибуция пересылки (privacy forwards): вместо
	// ссылки на аккаунт хранится только имя автора текстом (tweb fwd_from.from_name).
	FwdFromName *string
	// FwdFrom — атрибуция пересылки в форме оригинала (messageFwdHeader), то
	// есть ровно то, что уходит на провод. ВЫЧИСЛЯЕМОЕ поле (как Media и
	// ReplyTo): в строке messages лежат плоские fwd_from_*, а собрать из них
	// from_id:Peer можно только зная ВИД чата-источника — иначе приватный
	// источник отдал бы внутренний ключ chats. Наполняется
	// Interactor.HydrateMessagePeers; nil — пересылки нет.
	FwdFrom *MessageFwdHeader
	// IsDiscussionMirror — это сообщение является зеркалом поста канала в его
	// группе обсуждения (Telegram: пост дублируется в связанную группу, а
	// комментарии отвечают на зеркало). Отличает зеркало от обычной пересылки:
	// по fwd_from_* они неразличимы.
	IsDiscussionMirror bool
	// ReplyTo is a lightweight preview of the replied-to message, populated by
	// the history read model (not stored). Nil when this isn't a reply.
	ReplyTo *ReplyPreview
	// Ответ с цитатой фрагмента (Telegram reply quote): выделенный кусок текста
	// отвечаемого сообщения + его offset (UTF-16) в плоском тексте оригинала.
	// Хранятся на отвечающем сообщении; nil — обычный ответ на всё сообщение.
	ReplyQuoteText   *string
	ReplyQuoteOffset *int
	// Ответ на сообщение из ДРУГОГО чата (schema messageReplyHeader.
	// reply_to_peer_id): исходный чат оригинала (ReplyToID — НОМЕР того
	// сообщения). Nil — обычный ответ в том же чате.
	//
	// ReplySnapshotName — имя автора оригинала, когда сам оригинал зрителю
	// недоступен: на проводе это reply_from.from_name, то есть та же форма, что
	// у скрытой пересылки — имя без ссылки на аккаунт.
	//
	// Снимка ТЕКСТА оригинала здесь больше нет. В схеме недоступный оригинал
	// выражается парой reply_from/reply_media, и его текст не едет вовсе:
	// превью строится из цитаты (quote_text) либо из вложения. Наш
	// reply_snapshot_text предмета в схеме не имел и был последним местом, где
	// сервер обрезал чужой текст за клиента.
	ReplyToPeerID     *int64
	ReplySnapshotName string
	// ReplyToPeer — тот же исходный чат в форме ССЫЛКИ НА ПИР (schema
	// messageReplyHeader.reply_to_peer_id:Peer). ВЫЧИСЛЯЕМОЕ поле по той же
	// причине, что и FwdFrom: у приватного источника ключом пира служит
	// собеседник, а не строка chats. Наполняется HydrateMessagePeers.
	ReplyToPeer Peer
	// Media — вложение сообщения в форме оригинала (MTProto):
	// messageMediaPhoto/messageMediaDocument с лестницей превью и атрибутами
	// (см. domain/mtmedia.go). Наполняется read-моделью истории (в строке
	// messages лежит только media_id), поэтому клиент рисует бабл целиком из
	// сообщения — точный бокс, stripped-плейсхолдер, контур стикера, тип
	// документа — без отдельного запроса меты файла. nil, когда медиа нет.
	//
	// Плоского набора (media_w/media_h/media_mime/media_duration/…) здесь больше
	// нет: тип документа выводится из атрибутов, как в appDocsManager, а не
	// подделывается флагами витрины.
	Media MessageMedia
	// MediaSpoiler — медиа скрыто спойлером (telegram messageMedia.pFlags.spoiler,
	// tweb makeMessageMediaInput.ts:13,24). В отличие от MediaAnimated это не
	// свойство файла, а свойство вложения В ЭТОМ сообщении — ставит отправитель,
	// поэтому колонка messages.media_spoiler (миграция 0099). Клиент рисует медиа
	// под снимаемой кликом заслонкой и не автоплеит видео (tweb bubbles.ts:8570,
	// :8579 — wrapMediaSpoiler). Имеет смысл только при MediaID != nil.
	MediaSpoiler bool
	// Views is the deduplicated viewer count for a channel post (0 for
	// group/private messages, which don't track views).
	Views int64
	// Forwards is the number of times a channel post was forwarded (Telegram
	// message.forwards); incremented on each forward, shown under the post like Views.
	Forwards int64
	// MediaUnread mirrors Telegram's pFlags.media_unread: a voice/round-video
	// message whose content hasn't been played by the recipient yet. Set on
	// send, cleared by ReadMedia.
	MediaUnread bool
	// Гео-точка сообщения типа 'geo' (nil у остальных типов).
	GeoLat *float64
	GeoLng *float64
	// Расширение гео (jsonb geo_meta). Venue: название/адрес места. Live location:
	// GeoLivePeriod (сек трансляции; nil — обычная точка), GeoHeading (0..359),
	// GeoLiveStopped (остановлена досрочно). Время последнего обновления live —
	// EditedAt (бампится при каждом обновлении координат).
	GeoTitle       *string
	GeoAddress     *string
	GeoLivePeriod  *int
	GeoHeading     *int
	GeoLiveStopped bool
	// Контакт сообщения типа 'contact': снимок имени/телефона на момент отправки
	// плюс ссылка на аккаунт (по ней клиент открывает чат/аватар).
	ContactUserID *int64
	ContactName   *string
	ContactPhone  *string
	// Reactions — агрегаты реакций (emoji, count, mine) для зрителя, наполняется
	// read-моделью истории (не хранится на строке сообщения). Nil — реакций нет.
	Reactions []ReactionCount
	// GiftID — выданный подарок сообщения типа 'gift' (messages.gift_id); Gift —
	// его развёрнутое представление, наполняется read-моделью истории.
	GiftID *int64
	Gift   *GiftInfo
	// ReplyMarkup — клавиатура сообщения, обычно у сообщений бота: объединение
	// конструкторов схемы (replyInlineMarkup | replyKeyboardMarkup |
	// replyKeyboardHide | replyKeyboardForceReply), см. mtreplymarkup.go.
	// nil — клавиатуры нет.
	ReplyMarkup ReplyMarkup
	// E2E-шифртекст сообщения типа 'encrypted' (iv||ciphertext). Text/Entities
	// у таких сообщений пустые — сервер хранит блоб непрозрачно.
	EncBody []byte
	// Self-destruct: TTLSeconds задаёт отправитель; DestructAt сервер ставит при
	// прочтении получателем (now + ttl), затем reaper сносит блоб.
	TTLSeconds *int
	DestructAt *time.Time
	// WebPage — серверное превью первой ссылки текстового сообщения (jsonb
	// web_page). Заполняется асинхронно после отправки; nil — превью нет.
	WebPage *WebPagePreview
	// FactCheck — «проверка фактов» на сообщении (jsonb factcheck): текст +
	// сущности + опц. страна. Ставит/снимает автор/админ канала; nil — нет.
	FactCheck *FactCheck
	// Transcription — расшифровка голосового/видео-кружка (messages.transcription,
	// Telegram transcribeAudio). Кэшируется по запросу; nil — ещё не расшифровано.
	Transcription *string
	// Effect — вид полноэкранного canvas-эффекта сообщения (наш аналог Telegram
	// message effects): fireworks|confetti|hearts|thumbs|poop|cake, "" — нет.
	// Санитизируется на отправке (whitelist); только у text/media-сообщений.
	Effect string
	// Paid media (Telegram paid media — медиа, разблокируемое за Stars).
	// PaidMediaPrice — цена доступа в звёздах (nil — медиа не платное). Хранится в
	// отдельной таблице paid_media, наполняется read-моделью (не колонка messages).
	// PaidMediaLocked — per-viewer: контент скрыт до оплаты. У скрытого сообщения
	// read-модель обнуляет media_id/mime/имя, оставляя только размеры/blur/цену —
	// байты медиа клиенту не отдаются до разблокировки.
	PaidMediaPrice  *int64
	PaidMediaLocked bool
	// Платная ⭐-реакция (Telegram paid/star reactions). StarReactionTotal —
	// суммарное число звёзд на сообщении, StarReactionMine — вклад зрителя.
	// Хранятся в отдельной таблице star_reactions, наполняются read-моделью
	// (не колонки messages). Total==0 — платных реакций нет.
	StarReactionTotal int64
	StarReactionMine  int64
	// Send-as (schema send_as): когда задан — сообщение отображается от имени
	// этого канала/группы. Колонка messages.send_as_chat_id; nil — обычная
	// отправка.
	//
	// Снимка отображаемого автора (title/photo) здесь больше нет: на проводе
	// send-as выражается тем, что from_id это САМ КАНАЛ, а название и аватарка
	// приезжают карточкой чата — ровно как у любого другого пира после того,
	// как с провода ушёл display_name.
	SendAsChatID *int64
}

// ReplyPreview is the quoted snippet shown above a reply bubble.
//
// Адресуется ОДНИМ числом — Seq, тем самым, что в схеме зовётся message.id
// (пара «пир + id»). Глобального messages.id здесь больше нет: он ключ строки
// нашей базы и наружу не выходит.
type ReplyPreview struct {
	Seq      int64
	SenderID int64
	Text     string
	Entities MessageEntities // formatting of the quoted snippet (nil when truncated/plain)
	Type     string
	MediaID  *int64 // the replied message's media, for a thumbnail in the quote box
	// QuoteText — выделенный при ответе фрагмент оригинала (reply quote). Пусто —
	// цитаты нет, показывается превью всего сообщения (поле Text).
	QuoteText string
}

// CalendarDay — ОТРЕЗОК одного дня в пикере даты (tweb
// messages.getSearchResultsCalendar): дата, границы номеров и счётчик.
//
// Здесь стояла запись «само сообщение в ячейку не кладут ни там, ни здесь: в
// ячейку нужен один кружок, а не бабл», и она НЕВЕРНА — проверено по
// исходникам. `datePicker.tsx:437-444` берёт `result.messages`, кладёт в
// ячейку дня САМ ОБЪЕКТ сообщения и рисует превью из `message.media`; вектор
// `periods` он не читает вовсе. Наши `MediaID`/`Type`/`HasThumb` были
// выжимкой медиа — снимком вместо ссылки, тем же дефектом, что уже убирался у
// диалогов и контактов.
//
// Поэтому предмет здесь ровно один: границы дня. Медиа приезжает сообщением,
// на которое отрезок ссылается (`TopSeq`).
type CalendarDay struct {
	Day time.Time
	// MinSeq/MaxSeq — границы номеров этого дня, как у отрезка оригинала.
	MinSeq int64
	MaxSeq int64
	// Count — сколько медиа-сообщений в этом дне.
	Count int
	// TopSeq — номер сообщения, которое рисуется в ячейке: последнее за день,
	// как выбирает оригинал (первое пришедшее по убыванию даты).
	TopSeq int64
}
