package ws

import (
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// Frame is the WS envelope: a type tag and an opaque JSON payload.
type Frame struct {
	T string          `json:"t"`
	D json.RawMessage `json:"d,omitempty"`
}

type sendMessageData struct {
	ChatID    int64                  `json:"chat_id"`
	Type      string                 `json:"type"`
	Text      string                 `json:"text"`
	Entities  []domain.MessageEntity `json:"entities"`
	ReplyToID *int64                 `json:"reply_to_id"`
	// Ответ с цитатой фрагмента (Telegram reply quote): текст выделенного куска
	// оригинала + его offset (UTF-16). Применяются только вместе с reply_to_id.
	ReplyQuoteText   *string `json:"reply_quote_text"`
	ReplyQuoteOffset *int    `json:"reply_quote_offset"`
	ClientMsgID      string  `json:"client_msg_id"`
	MediaID          *int64  `json:"media_id"`
	GroupedID        string  `json:"grouped_id"`
	// Гео-точка (type 'geo') / контакт (type 'contact').
	GeoLat        *float64 `json:"geo_lat"`
	GeoLng        *float64 `json:"geo_lng"`
	GeoTitle      *string  `json:"geo_title"`
	GeoAddress    *string  `json:"geo_address"`
	GeoLivePeriod *int     `json:"geo_live_period"`
	GeoHeading    *int     `json:"geo_heading"`
	ContactUserID *int64   `json:"contact_user_id"`
	// Сообщение в тред (форум-топик / комментарии): id корневого сообщения.
	ThreadRootID *int64 `json:"thread_root_id"`
	// E2E (type 'encrypted'): base64 iv||ciphertext + опциональный self-destruct TTL.
	EncBody    string `json:"enc_body"` // base64 iv||ciphertext
	TTLSeconds *int   `json:"ttl_seconds"`
	// Тихая отправка (Telegram disable_notification): без push/звука у получателя.
	Silent bool `json:"silent"`
}

type readData struct {
	ChatID  int64 `json:"chat_id"`
	UpToSeq int64 `json:"up_to_seq"`
}

type readMediaData struct {
	ChatID int64 `json:"chat_id"`
	MsgID  int64 `json:"msg_id"`
}

type typingData struct {
	ChatID int64  `json:"chat_id"`
	Action string `json:"action"` // "typing" | "voice" | "video" (default typing)
}
