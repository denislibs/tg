package ws

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
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
// callData — исход 1:1 звонка глазами клиента, который его вёл.
type callData struct {
	Video    bool   `json:"video"`
	Reason   string `json:"reason"` // missed|busy|cancelled|ok
	Duration int    `json:"duration"`
}

type sendMessageData struct {
	PeerID   domain.PeerID          `json:"peer_id"`
	Type     string                 `json:"type"`
	Text     string                 `json:"text"`
	Entities domain.MessageEntities `json:"entities"`
	// reply_to_id — НОМЕР отвечаемого сообщения (schema reply_to_msg_id);
	// reply_to_peer_id — ключ пира, когда отвечают в ДРУГОЙ чат (его отсутствие
	// значит «тот же пир»). Порознь они сообщение не адресуют.
	ReplyToID     *int64         `json:"reply_to_id"`
	ReplyToPeerID *domain.PeerID `json:"reply_to_peer_id"`
	// Ответ с цитатой фрагмента (Telegram reply quote): текст выделенного куска
	// оригинала + его offset (UTF-16). Применяются только вместе с reply_to_id.
	ReplyQuoteText   *string `json:"reply_quote_text"`
	ReplyQuoteOffset *int    `json:"reply_quote_offset"`
	ClientMsgID      string  `json:"client_msg_id"`
	MediaID          *int64  `json:"media_id"`
	GroupedID        int64   `json:"grouped_id"`
	// Гео-точка (type 'geo') / контакт (type 'contact').
	GeoLat        *float64 `json:"geo_lat"`
	GeoLng        *float64 `json:"geo_lng"`
	GeoTitle      *string  `json:"geo_title"`
	GeoAddress    *string  `json:"geo_address"`
	GeoLivePeriod *int     `json:"geo_live_period"`
	GeoHeading    *int     `json:"geo_heading"`
	ContactUserID *int64   `json:"contact_user_id"`
	// Сообщение в тред (форум-топик / комментарии): НОМЕР корневого сообщения.
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
	// Call — исход завершившегося звонка: сервер кладёт в чат СЛУЖЕБНОЕ
	// сообщение messageActionPhoneCall. Прежде клиент присылал type == "call"
	// и JSON {video, reason, duration} внутри ТЕКСТА.
	Call *callData `json:"call"`
}

type readData struct {
	PeerID  domain.PeerID `json:"peer_id"`
	UpToSeq int64         `json:"up_to_seq"`
}

// readMediaData — «медиа прослушано». Сообщение адресуется парой «пир +
// номер», как и везде: ключ `id` со значением seq.
type readMediaData struct {
	PeerID domain.PeerID `json:"peer_id"`
	Seq    int64         `json:"id"`
}

// typingData — «печатает» от клиента. Действие едет КОНСТРУКТОРОМ объединения
// SendMessageAction (у оригинала это messages.setTyping{peer, action}), а не
// строкой из шести значений: одна форма на обе стороны провода.
type typingData struct {
	PeerID domain.PeerID `json:"peer_id"`
	Action struct {
		Underscore string `json:"_"`
	} `json:"action"`
}

// replyPeerChatID — reply_to_peer_id входящего кадра (ключ пира ЧУЖОГО чата)
// во внутренний chatID. nil/0 — ответ в том же чате: в схеме отсутствие
// reply_to_peer_id значит «тот же пир».
func replyPeerChatID(ctx context.Context, svc peerResolver, viewerID int64, peer *domain.PeerID) (*int64, error) {
	if peer == nil || *peer == domain.NullPeerID {
		return nil, nil
	}
	chatID, err := svc.PeerToChatID(ctx, viewerID, *peer)
	if err != nil {
		return nil, err
	}
	return &chatID, nil
}

// peerResolver — та часть usecase, которой хватает разрешению чужого пира.
type peerResolver interface {
	PeerToChatID(ctx context.Context, viewerID int64, peer domain.PeerID) (int64, error)
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

// callAction — конструктор лога звонка из кадра send_message (nil — звонка
// нет). Единственный способ, которым клиент может создать СЛУЖЕБНОЕ сообщение:
// произвольное действие он назначить не может, поля action на входе нет вовсе.
func callAction(c *callData) domain.MessageAction {
	if c == nil {
		return nil
	}
	return usecasechat.PhoneCallAction(c.Video, c.Reason, c.Duration)
}
