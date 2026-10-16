package ws

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// Frame is the WS envelope: a type tag and an opaque JSON payload.
type Frame struct {
	T string          `json:"t"`
	D json.RawMessage `json:"d,omitempty"`
}

// Входящие кадры адресуют ПИРА знаковым ключом (пользователь ≥ 0, чат < 0);
// внутренний chatID достаёт слой разрешения (usecase/chat/peeraddr.go).
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
	// Гео-точка (type 'geo').
	GeoLat        *float64 `json:"geo_lat"`
	GeoLng        *float64 `json:"geo_lng"`
	GeoTitle      *string  `json:"geo_title"`
	GeoAddress    *string  `json:"geo_address"`
	GeoLivePeriod *int     `json:"geo_live_period"`
	GeoHeading    *int     `json:"geo_heading"`
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
	// no_webpage / invert_media — превью ссылки (TL messages.sendMessage/
	// sendMedia). Ключ `media` — объединение InputMedia: inputMediaWebPage
	// (решение о превью) или inputMediaContact (type 'contact', В-10: поля
	// визитки от отправителя 1:1, user_id сервер выводит сам).
	NoWebpage   bool             `json:"no_webpage"`
	InvertMedia bool             `json:"invert_media"`
	Media       domain.SendMedia `json:"media"`
	// ScheduleDate — отложенная отправка (schema schedule_date, unix-секунды;
	// 0x7FFFFFFE — «когда будет в сети»), ScheduleRepeatPeriod — её повтор
	// (tweb appMessagesManager.ts:2741-2742).
	ScheduleDate         int64 `json:"schedule_date"`
	ScheduleRepeatPeriod int   `json:"schedule_repeat_period"`
	// AllowPaidStars — сумма, на которую отправитель согласился в платной
	// группе (tweb allow_paid_stars, appMessagesManager.ts:2702): цена ЭТОГО
	// кадра; 0/нет — не согласен.
	AllowPaidStars int64 `json:"allow_paid_stars"`
}

// webPage — решение отправителя о превью ссылки из тела кадра.
func (d sendMessageData) webPage() domain.WebPageInput {
	return d.Media.WebPageInput(d.NoWebpage, d.InvertMedia)
}

type readData struct {
	PeerID  domain.PeerID `json:"peer_id"`
	UpToSeq int64         `json:"up_to_seq"`
}

// readMediaData — «медиа прослушано»: messages.readMessageContents{id:
// Vector<int>}. Сообщения адресуются парой «пир + номера», как и везде: ключ
// `id` со списком seq.
type readMediaData struct {
	PeerID domain.PeerID `json:"peer_id"`
	IDs    []int64       `json:"id"`
}

// typingData — «печатает» от клиента. Действие едет КОНСТРУКТОРОМ объединения
// SendMessageAction (у оригинала это messages.setTyping{peer, action}), а не
// строкой из шести значений: одна форма на обе стороны провода.
//
// top_msg_id — серверный номер корня треда или темы (messages.setTyping
// {top_msg_id}); ключа нет — печать вне треда.
type typingData struct {
	PeerID   domain.PeerID `json:"peer_id"`
	TopMsgID *int64        `json:"top_msg_id,omitempty"`
	Action   struct {
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

// groupCallRejectedFrame — ответ ОДНОМУ соединению на group_call_join, на который
// сервер не пустил (Б-9): клиент откатывает локальный звонок без group_call_leave.
// peer_id — тот, что прислал клиент (ключ глазами получателя). Списка участников
// нет: отказ бывает и при сбое хранилища, когда звонок идёт — клиент activeByChat
// не трогает. forbidden — отказ по праву/политике (ErrForbidden), иначе сбой
// хранилища: клиент по-разному объясняет это пользователю.
func groupCallRejectedFrame(peer domain.PeerID, userID int64, forbidden bool) []byte {
	f, _ := json.Marshal(map[string]any{
		"t": "group_call_update",
		"d": map[string]any{"peer_id": peer, "user_id": userID, "action": "rejected", "forbidden": forbidden},
	})
	return f
}
