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

// helloFrame is the FIRST frame sent on connect: the user's current update cursor
// (pts) and date, so a client whose cursor already matches can skip catch-up.
func helloFrame(st domain.UserState) []byte {
	b, err := json.Marshal(map[string]any{
		"t": "hello",
		"d": map[string]any{"pts": st.Pts, "date": st.Date},
	})
	if err != nil {
		return nil
	}
	return b
}

// Входящие кадры адресуют ПИРА знаковым ключом (пользователь ≥ 0, чат < 0);
// внутренний chatID достаёт слой разрешения (usecase/chat/peeraddr.go).
type sendMessageData struct {
	PeerID    domain.PeerID          `json:"peer_id"`
	Type      string                 `json:"type"`
	Text      string                 `json:"text"`
	Entities  domain.MessageEntities `json:"entities"`
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
	// Effect — вид эффекта сообщения (наш аналог Telegram message effects).
	Effect string `json:"effect"`
	// PaidMediaPrice — цена платного медиа (Telegram paid media) в звёздах.
	PaidMediaPrice *int64 `json:"paid_media_price"`
	// MediaSpoiler — скрыть медиа спойлером (Telegram messageMedia.pFlags.spoiler);
	// работает только вместе с media_id.
	MediaSpoiler bool `json:"media_spoiler"`
	// SendAsPeerID — отправка от имени канала/группы (Telegram send_as); nil — от себя.
	SendAsPeerID *domain.PeerID `json:"send_as_peer_id"`
}

type readData struct {
	PeerID  domain.PeerID `json:"peer_id"`
	UpToSeq int64         `json:"up_to_seq"`
}

type readMediaData struct {
	PeerID domain.PeerID `json:"peer_id"`
	MsgID  int64         `json:"msg_id"`
}

type typingData struct {
	PeerID domain.PeerID `json:"peer_id"`
	Action string        `json:"action"` // "typing" | "voice" | "video" (default typing)
}

// sendAsChatID — знаковый ключ «личности отправителя» во внутренний chatID.
// send-as бывает только каналом/супергруппой, поэтому это чистая арифметика:
// пользователь в этом поле смысла не имеет и трактуется как «от себя».
func sendAsChatID(peer *domain.PeerID) *int64 {
	if peer == nil || !peer.IsAnyChat() {
		return nil
	}
	id := peer.ToChatID()
	return &id
}

// peerData — кадры, у которых в теле только адрес пира (подписка на канал,
// вход/выход из группового звонка).
type peerData struct {
	PeerID domain.PeerID `json:"peer_id"`
}
