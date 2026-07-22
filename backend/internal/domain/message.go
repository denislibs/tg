package domain

import "time"

// MessageEntity is a rich-text formatting span over the message Text (Telegram
// MessageEntity model). Offset/Length are in UTF-16 code units (matching JS
// string indices on the client), so the same numbers slice the text identically
// on both ends. The backend stores/returns these opaquely (jsonb) — only the
// client interprets the units. URL is set only for "text_link" spans.
type MessageEntity struct {
	Type   string `json:"type"`               // bold|italic|underline|strikethrough|code|pre|spoiler|blockquote|text_link|text_mention
	Offset int    `json:"offset"`             // start, in UTF-16 code units
	Length int    `json:"length"`             // span length, in UTF-16 code units
	URL    string `json:"url,omitempty"`      // target for text_link
	Lang   string `json:"language,omitempty"` // language hint for pre code blocks
	UserID int64  `json:"user_id,omitempty"`  // target for text_mention (упоминание юзера без username)
}

// WebPagePreview — серверный снимок превью ссылки (Telegram webPage):
// og-теги первой http/https-ссылки текстового сообщения. Хранится на
// сообщении как jsonb (сообщение несёт снимок, кэш не нужен).
type WebPagePreview struct {
	URL         string `json:"url"`
	SiteName    string `json:"site_name,omitempty"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	ImageURL    string `json:"image_url,omitempty"`
}

type Message struct {
	ID           int64
	ChatID       int64
	Seq          int64
	SenderID     int64
	Type         string
	Text         string
	Entities     []MessageEntity // rich-text formatting spans over Text (nil when plain)
	ReplyToID    *int64
	MediaID      *int64
	ClientMsgID  *string
	ThreadRootID *int64
	// GroupedID — идентификатор медиагруппы (Telegram grouped_id): сообщения
	// одного альбома несут общий id, клиент рендерит их одним грид-баблом.
	GroupedID *string
	// PollID — опрос сообщения типа 'poll' (messages.poll_id); Poll — его
	// развёрнутое представление для зрителя, наполняется read-моделью истории.
	PollID *int64
	Poll   *PollInfo
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
	// ReplyTo is a lightweight preview of the replied-to message, populated by
	// the history read model (not stored). Nil when this isn't a reply.
	ReplyTo *ReplyPreview
	// Ответ с цитатой фрагмента (Telegram reply quote): выделенный кусок текста
	// отвечаемого сообщения + его offset (UTF-16) в плоском тексте оригинала.
	// Хранятся на отвечающем сообщении; nil — обычный ответ на всё сообщение.
	ReplyQuoteText   *string
	ReplyQuoteOffset *int
	// Media dimensions/mime, populated by the history read model (not stored on the
	// message row) so the client can reserve the exact media box before the bytes
	// load — no layout shift. Zero when there's no media or it's unprocessed.
	MediaWidth    int
	MediaHeight   int
	MediaMime     string
	MediaBlur     []byte // blur preview bytes (JSON base64 — LQIP placeholder)
	MediaHasThumb bool
	MediaDuration int
	MediaSize     int64
	MediaName     string
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
	// ReplyMarkup — клавиатура сообщения (inline/reply), обычно у сообщений бота.
	ReplyMarkup *ReplyMarkup
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
	// SenderName is the sender's short name (first name, else display name),
	// populated on send for the new_message payload (not stored) — the client
	// prefixes group chat-list previews with it, tweb-style.
	SenderName string
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
}

// ReplyPreview is the quoted snippet shown above a reply bubble.
type ReplyPreview struct {
	MsgID    int64
	Seq      int64
	SenderID int64
	Text     string
	Entities []MessageEntity // formatting of the quoted snippet (nil when truncated/plain)
	Type     string
	MediaID  *int64 // the replied message's media, for a thumbnail in the quote box
	// QuoteText — выделенный при ответе фрагмент оригинала (reply quote). Пусто —
	// цитаты нет, показывается превью всего сообщения (поле Text).
	QuoteText string
}
