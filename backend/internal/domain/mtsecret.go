package domain

// Секретный чат: стадия handshake — КОНСТРУКТОР, а не строка рядом с ключом.
//
// Витрина отдавала пару `{peer_id, state}`, где `state` это наше перечисление
// (`requested`/`accepted`/`rejected`/`discarded`). У оригинала стадия и есть
// выбор конструктора объединения `EncryptedChat`, и вместе с ней меняется
// НАБОР полей: у запрошенного есть ключ инициатора, у установленного — ключ
// второй стороны, у отменённого нет ни того ни другого.

const (
	EncryptedChatRequestedTag = "encryptedChatRequested"
	EncryptedChatTag          = "encryptedChat"
	EncryptedChatDiscardedTag = "encryptedChatDiscarded"
)

// EncryptedChat — объединение схемы `EncryptedChat`. Производим три
// конструктора из пяти: `encryptedChatEmpty` (нет такого чата) и
// `encryptedChatWaiting` (ждём ответа сервера-посредника) у нас не возникают —
// запрос сразу несёт ключ инициатора.
type EncryptedChat interface {
	isEncryptedChat()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// encryptedChatRequested#48f1d94c flags:# folder_id:flags.0?int id:int
// access_hash:long date:int admin_id:long participant_id:long g_a:bytes
// = EncryptedChat;
//
// Запрос на секретный чат: инициатор прислал свой публичный ключ, ответа ещё
// нет. `access_hash` — транспортный токен MTProto, у нас его нет вовсе
// (OmittedWithoutSubject, как у фото и документа).
type EncryptedChatRequested struct {
	Underscore    string `json:"_"`
	ID            int64  `json:"id"`
	Date          int    `json:"date"`
	AdminID       int64  `json:"admin_id"`
	ParticipantID int64  `json:"participant_id"`
	GA            []byte `json:"g_a"`
}

func (EncryptedChatRequested) isEncryptedChat() {}
func (c EncryptedChatRequested) Tag() string    { return c.Underscore }

// encryptedChat#61f0d4c7 id:int access_hash:long date:int admin_id:long
// participant_id:long g_a_or_b:bytes key_fingerprint:long = EncryptedChat;
//
// Handshake завершён: вторая сторона прислала свой ключ. `key_fingerprint`
// не производим — общий ключ считает КЛИЕНТ (ECDH в воркере), сервер приватных
// ключей не видит и отпечаток вычислить не может.
type EncryptedChatReal struct {
	Underscore    string `json:"_"`
	ID            int64  `json:"id"`
	Date          int    `json:"date"`
	AdminID       int64  `json:"admin_id"`
	ParticipantID int64  `json:"participant_id"`
	GAOrB         []byte `json:"g_a_or_b"`
}

func (EncryptedChatReal) isEncryptedChat() {}
func (c EncryptedChatReal) Tag() string    { return c.Underscore }

// encryptedChatDiscarded#1e1c7c45 flags:# history_deleted:flags.0?true id:int
// = EncryptedChat;
//
// Отказ либо разрыв. Наши `rejected` и `discarded` сходятся сюда: разница
// между ними была только в том, кто нажал, а состояние чата одно.
type EncryptedChatDiscarded struct {
	Underscore string `json:"_"`
	ID         int64  `json:"id"`
}

func (EncryptedChatDiscarded) isEncryptedChat() {}
func (c EncryptedChatDiscarded) Tag() string    { return c.Underscore }

// NewEncryptedChat — стадия handshake КОНСТРУКТОРОМ. Ключи сторон едут ровно
// там, где их объявляет схема: инициатора — в `g_a` запроса, ответчика — в
// `g_a_or_b` установленного чата.
func NewEncryptedChat(sc SecretChat) EncryptedChat {
	date := unixSeconds(sc.CreatedAt)
	switch sc.State {
	case SecretRequested:
		return EncryptedChatRequested{
			Underscore: EncryptedChatRequestedTag, ID: sc.ChatID, Date: date,
			AdminID: sc.InitiatorID, ParticipantID: sc.ResponderID, GA: sc.InitiatorPub,
		}
	case SecretAccepted:
		return EncryptedChatReal{
			Underscore: EncryptedChatTag, ID: sc.ChatID, Date: date,
			AdminID: sc.InitiatorID, ParticipantID: sc.ResponderID, GAOrB: sc.ResponderPub,
		}
	default:
		return EncryptedChatDiscarded{Underscore: EncryptedChatDiscardedTag, ID: sc.ChatID}
	}
}
