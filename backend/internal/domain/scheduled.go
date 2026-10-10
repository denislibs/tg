package domain

import (
	"encoding/json"
	"slices"
	"time"
)

// SendWhenOnlineTimestamp — дата отложенного «отправить, когда собеседник появится
// в сети» (tweb `SEND_WHEN_ONLINE_TIMESTAMP`, `appManagers/constants.ts:29`).
const SendWhenOnlineTimestamp = 0x7FFFFFFE

// ScheduleRepeatPeriods — допустимые периоды повтора отложенного, секунды
// (schema message.schedule_repeat_period). Набор 1:1 с рядом «Повтор» tweb
// (`components/popups/scheduleSendingPopup.tsx:16-25`): день, неделя, две недели,
// 30, 91, 182 и 365 дней. 0 («Никогда») — отсутствие повтора.
var ScheduleRepeatPeriods = []int{86400, 7 * 86400, 14 * 86400, 30 * 86400, 91 * 86400, 182 * 86400, 365 * 86400}

// ValidScheduleRepeatPeriod — период из набора tweb либо 0.
func ValidScheduleRepeatPeriod(p int) bool {
	return p == 0 || slices.Contains(ScheduleRepeatPeriods, p)
}

// ScheduledMessage — отложенное сообщение. У оригинала отложенное — это ЛЮБАЯ
// отправка с `schedule_date` (tweb `appMessagesManager.ts:2741`, `:3230`,
// `:3779`, `:4149`, `:5652`), поэтому строка очереди хранит ПОЛНЫЙ снимок
// отправки: колонки — то, что у строки messages тоже колонки, остальное —
// ScheduledParams.
type ScheduledMessage struct {
	ID        int64
	ChatID    int64
	SenderID  int64
	Type      string
	Text      string
	Entities  MessageEntities
	ReplyToID *int64
	MediaID   *int64
	SendAt    time.Time
	CreatedAt time.Time
	// WhenOnline — «отправить, когда собеседник появится в сети» (sentinel
	// SendWhenOnlineTimestamp у оригинала). Только личка; SendAt тогда не
	// используется.
	WhenOnline bool
	// RepeatPeriod — повтор (schema schedule_repeat_period, секунды): после
	// публикации строка переставляется на SendAt+RepeatPeriod. 0 — без повтора.
	RepeatPeriod int
	// ClientMsgID — ключ идемпотентности постановки: повтор кадра отправки
	// после переподключения не плодит вторую строку.
	ClientMsgID *string
	Params      ScheduledParams
	// WebPage — превью ссылки отложенного (строит P1 после постановки); при
	// публикации переносится в сообщение без повторной сборки.
	WebPage *WebPagePreview
}

// ScheduledParams — параметры отправки, у которых в строке очереди нет своей
// колонки (jsonb scheduled_messages.params). Набор покрывает публичные поля
// SendInput: тест-скан usecase/chat сверяет, что новое поле отправки не
// теряется у отложенного.
type ScheduledParams struct {
	ReplyToPeerID    *int64   `json:"reply_to_peer_id,omitempty"`
	ReplyQuoteText   *string  `json:"reply_quote_text,omitempty"`
	ReplyQuoteOffset *int     `json:"reply_quote_offset,omitempty"`
	ThreadRootID     *int64   `json:"thread_root_id,omitempty"` // ключ строки корня
	GroupedID        int64    `json:"grouped_id,omitempty"`
	PollID           *int64   `json:"poll_id,omitempty"`
	ChecklistID      *int64   `json:"checklist_id,omitempty"`
	GeoLat           *float64 `json:"geo_lat,omitempty"`
	GeoLng           *float64 `json:"geo_lng,omitempty"`
	GeoTitle         *string  `json:"geo_title,omitempty"`
	GeoAddress       *string  `json:"geo_address,omitempty"`
	GeoLivePeriod    *int     `json:"geo_live_period,omitempty"`
	GeoHeading       *int     `json:"geo_heading,omitempty"`
	ContactUserID    *int64   `json:"contact_user_id,omitempty"`
	Silent           bool     `json:"silent,omitempty"`
	Effect           string   `json:"effect,omitempty"`
	PaidMediaPrice   *int64   `json:"paid_media_price,omitempty"`
	MediaSpoiler     bool     `json:"media_spoiler,omitempty"`
	SendAsChatID     *int64   `json:"send_as_chat_id,omitempty"`
	// ContactName/ContactPhone — снимок карточки контакта на момент постановки
	// (только для отдачи ленты: при публикации Send гидрирует контакт заново).
	ContactName  *string `json:"contact_name,omitempty"`
	ContactPhone *string `json:"contact_phone,omitempty"`
	// Fwd — отложенная ПЕРЕСЫЛКА (tweb `messages.forwardMessages{schedule_date}`,
	// `appMessagesManager.ts:5652`): содержимое снято copyContent при
	// постановке, здесь — атрибуция и то, что нужно доставке копии.
	Fwd *ScheduledFwd `json:"fwd,omitempty"`
}

// ScheduledFwd — снимок пересылки для отложенной копии.
type ScheduledFwd struct {
	SrcMsgID   int64   `json:"src_msg_id"` // ключ строки исходника (счётчик forwards)
	FromUserID *int64  `json:"from_user_id,omitempty"`
	FromChatID *int64  `json:"from_chat_id,omitempty"`
	FromMsgID  *int64  `json:"from_msg_id,omitempty"`
	FromName   *string `json:"from_name,omitempty"`
	Date       *int64  `json:"date,omitempty"` // unix-секунды
	GiveawayID *int64  `json:"giveaway_id,omitempty"`
	// ReplyMarkup — inline-клавиатура бота, которую копия переносит (copyableMarkup).
	ReplyMarkup json.RawMessage `json:"reply_markup,omitempty"`
	// Платное медиа исходника: копия продаётся тем же предложением.
	OfferPrice int64 `json:"offer_price,omitempty"`
	OfferID    int64 `json:"offer_id,omitempty"`
}

// Date — дата отложенного на проводе: момент отправки либо sentinel «когда в сети».
func (m ScheduledMessage) Date() time.Time {
	if m.WhenOnline {
		return time.Unix(SendWhenOnlineTimestamp, 0)
	}
	return m.SendAt
}

// Message — отложенное в форме строки messages: из неё общая сборка
// (Message.ToWire) делает тот же конструктор `message`, что у отправленного.
//
// Идентичность СВОЯ: номера в чате у неотправленного нет, поэтому Seq — ключ
// строки scheduled_messages, а ID — ноль (по ключу строки messages для
// отложенного ничего не ищется: ни реакций, ни закрепа, ни треда).
func (m ScheduledMessage) Message() Message {
	p := m.Params
	msg := Message{
		ChatID: m.ChatID, Seq: m.ID, SenderID: m.SenderID,
		Type: m.Type, Text: m.Text, Entities: m.Entities,
		ReplyToID: m.ReplyToID, MediaID: m.MediaID, ClientMsgID: m.ClientMsgID,
		ThreadRootID: p.ThreadRootID, PollID: p.PollID, ChecklistID: p.ChecklistID,
		CreatedAt:      m.Date(),
		ReplyQuoteText: p.ReplyQuoteText, ReplyQuoteOffset: p.ReplyQuoteOffset,
		ReplyToPeerID: p.ReplyToPeerID,
		GeoLat:        p.GeoLat, GeoLng: p.GeoLng, GeoTitle: p.GeoTitle, GeoAddress: p.GeoAddress,
		GeoLivePeriod: p.GeoLivePeriod, GeoHeading: p.GeoHeading,
		ContactUserID: p.ContactUserID, ContactName: p.ContactName, ContactPhone: p.ContactPhone,
		Effect: p.Effect, SendAsChatID: p.SendAsChatID,
		MediaSpoiler: p.MediaSpoiler && m.MediaID != nil,
		WebPage:      m.WebPage,
	}
	if p.GroupedID != 0 && m.MediaID != nil {
		g := p.GroupedID
		msg.GroupedID = &g
	}
	if p.PaidMediaPrice != nil && *p.PaidMediaPrice > 0 && m.MediaID != nil {
		price := *p.PaidMediaPrice
		msg.PaidMediaPrice = &price
	}
	if f := p.Fwd; f != nil {
		msg.FwdFromUserID, msg.FwdFromChatID, msg.FwdFromMsgID = f.FromUserID, f.FromChatID, f.FromMsgID
		msg.FwdFromName = f.FromName
		if f.Date != nil {
			d := time.Unix(*f.Date, 0)
			msg.FwdDate = &d
		}
		msg.GiveawayID = f.GiveawayID
		if len(f.ReplyMarkup) > 0 {
			if rm, err := UnmarshalReplyMarkup(f.ReplyMarkup); err == nil {
				msg.ReplyMarkup = rm
			}
		}
		if f.OfferPrice > 0 && m.MediaID != nil {
			price := f.OfferPrice
			msg.PaidMediaPrice = &price
		}
	}
	return msg
}

// ToWire — отложенное тем же конструктором `message`, что и отправленное:
// base — результат общей сборки (Message.ToWire) над Message() после гидрации
// медиа. Сверху ставятся признаки отложенного:
//
//   - pFlags.is_scheduled — клиентский флаг оригинала (schema_additional_params);
//   - pFlags.out — отложенные видит только автор;
//   - date — момент отправки либо sentinel SendWhenOnlineTimestamp (tweb
//     `chat/dateBubble.ts:20-21` режет по ней ленту отложенных);
//   - schedule_repeat_period — повтор (tweb `chat/messageRender.ts:358`).
//
// SendAt и WhenOnline — НАШИ параметры вне схемы, дублирующие дату явным видом
// (объявлены штатным механизмом клиентских параметров).
func (m ScheduledMessage) ToWire(base MessageReal) MessageReal {
	base.ID = m.ID
	base.Date = unixSeconds(m.Date())
	setPFlag(&base.PFlags, "out", true)
	setPFlag(&base.PFlags, "is_scheduled", true)
	base.ScheduleRepeatPeriod = m.RepeatPeriod
	base.SendAt = m.SendAt.Unix()
	base.WhenOnline = m.WhenOnline
	return base
}
