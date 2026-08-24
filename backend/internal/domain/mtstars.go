package domain

import "strconv"

// Звёзды: баланс, история движений и витрины подарков.
//
// Баланс ехал ГОЛЫМ ЧИСЛОМ под ключом `balance`, история — вектором наших
// строк с видом операции СТРОКОЙ (`kind: "topup"|"gift_sent"|"gift_converted"`).
// У оригинала и то и другое — конструкторы: сумма это `starsAmount` (целые
// плюс нанодоли), а вид операции выражают ФЛАГ и КОНСТРУКТОР второй стороны.

const (
	StarsAmountTag                     = "starsAmount"
	StarsTransactionTag                = "starsTransaction"
	StarsTransactionPeerTag            = "starsTransactionPeer"
	StarsTransactionPeerUnsupportedTag = "starsTransactionPeerUnsupported"
	PaymentsStarsStatusTag             = "payments.starsStatus"
	PaymentsStarGiftsTag               = "payments.starGifts"
	PaymentsSavedStarGiftsTag          = "payments.savedStarGifts"
)

// starsAmount#bbb6b4a3 amount:long nanos:int = StarsAmount;
//
// У оригинала звёзды ДРОБНЫЕ: целая часть в `amount`, девять знаков после
// запятой — в `nanos`. Наш баланс целый, поэтому nanos всегда ноль; но форма
// обязана быть той же, иначе первая же дробная цена (а они у оригинала есть)
// не выразится вовсе.
type StarsAmount struct {
	Underscore string `json:"_"`
	Amount     int64  `json:"amount"`
	// Nanos — дробная часть, миллиардные доли звезды. У нас всегда 0: цены и
	// балансы целые. Параметр обязательный, поэтому едет нулём, а не опускается.
	Nanos int `json:"nanos"`
}

// NewStarsAmount — целое число звёзд.
func NewStarsAmount(amount int64) StarsAmount {
	return StarsAmount{Underscore: StarsAmountTag, Amount: amount}
}

// ── StarsTransactionPeer: вторая сторона движения ──────────────────────────

// StarsTransactionPeer — объединение «с кем прошло движение».
type StarsTransactionPeer interface {
	isStarsTransactionPeer()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// starsTransactionPeer#d80da15d peer:Peer = StarsTransactionPeer;
type StarsTransactionPeerReal struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
}

func (StarsTransactionPeerReal) isStarsTransactionPeer() {}
func (p StarsTransactionPeerReal) Tag() string           { return p.Underscore }

// starsTransactionPeerUnsupported#95f2bfe4 = StarsTransactionPeer;
//
// Второй стороны у движения нет либо она не выражается пиром: у нас это
// пополнение (реальной оплаты в стенде не существует) и обмен подарка на
// звёзды. Оригинал ставит здесь конструктор магазина или премиум-бота —
// сущностей, которых у нас нет вовсе.
type StarsTransactionPeerUnsupported struct {
	Underscore string `json:"_"`
}

func (StarsTransactionPeerUnsupported) isStarsTransactionPeer() {}
func (p StarsTransactionPeerUnsupported) Tag() string           { return p.Underscore }

// NewStarsTransactionPeer — вторая сторона движения: пир либо «не выражается».
func NewStarsTransactionPeer(peer *int64) StarsTransactionPeer {
	if peer == nil {
		return StarsTransactionPeerUnsupported{Underscore: StarsTransactionPeerUnsupportedTag}
	}
	return StarsTransactionPeerReal{Underscore: StarsTransactionPeerTag, Peer: NewPeer(PeerID(*peer))}
}

// starsTransaction#13659eb0 flags:# … gift:flags.10?true … id:string
// amount:StarsAmount date:int peer:StarsTransactionPeer title:flags.0?string …
// = StarsTransaction;
//
// СТРОКА истории кошелька. Вида операции строкой (`kind`) здесь нет: «это
// подарок» говорит ФЛАГ, «кому/от кого» — конструктор второй стороны, а
// «начисление или списание» — знак суммы. Прежде тот же ответ давало
// перечисление из четырёх значений, одно из которых (`paid_media`) не
// производилось вовсе.
//
// `id` у схемы СТРОКА: у оригинала это не наш ключ строки, а идентификатор
// платежа.
type StarsTransaction struct {
	Underscore string               `json:"_"`
	PFlags     map[string]bool      `json:"pFlags,omitempty"`
	ID         string               `json:"id"`
	Amount     StarsAmount          `json:"amount"`
	Date       int                  `json:"date"`
	Peer       StarsTransactionPeer `json:"peer"`
	Title      string               `json:"title,omitempty"`
}

// NewStarsTransaction собирает строку истории. `gift` — движение по подарку
// (отправка либо обмен).
func NewStarsTransaction(id, amount int64, date int, peer *int64, title string, gift bool) StarsTransaction {
	out := StarsTransaction{
		Underscore: StarsTransactionTag,
		ID:         strconv.FormatInt(id, 10),
		Amount:     NewStarsAmount(amount),
		Date:       date,
		Peer:       NewStarsTransactionPeer(peer),
		Title:      title,
	}
	setPFlag(&out.PFlags, "gift", gift)
	return out
}

// payments.starsStatus#6c9ce8ed flags:# balance:StarsAmount
// subscriptions:flags.1?Vector<StarsSubscription> … history:flags.3?Vector<StarsTransaction>
// next_offset:flags.0?string chats:Vector<Chat> users:Vector<User>
// = payments.StarsStatus;
//
// Ответ ЛЮБОЙ операции с балансом: и запрос остатка, и пополнение, и обмен
// подарка. `history` едет только там, где её спрашивали, — отсутствие ключа
// значит «историю не просили», а не «она пуста».
type PaymentsStarsStatus struct {
	Underscore string             `json:"_"`
	Balance    StarsAmount        `json:"balance"`
	History    []StarsTransaction `json:"history,omitempty"`
	Chats      []Chat             `json:"chats"`
	Users      []UserReal         `json:"users"`
}

// NewStarsStatus — только остаток.
func NewStarsStatus(balance int64) PaymentsStarsStatus {
	return PaymentsStarsStatus{
		Underscore: PaymentsStarsStatusTag,
		Balance:    NewStarsAmount(balance),
		Chats:      []Chat{},
		Users:      []UserReal{},
	}
}

// NewStarsStatusWithHistory — остаток вместе с историей движений.
func NewStarsStatusWithHistory(balance int64, history []StarsTransaction) PaymentsStarsStatus {
	out := NewStarsStatus(balance)
	out.History = orEmpty(history)
	return out
}

// payments.starGifts#2ed82995 hash:int gifts:Vector<StarGift> chats:Vector<Chat>
// users:Vector<User> = payments.StarGifts;
//
// Каталог подарков. `hash` — ключ кэша запроса; хэш-кэширования запросов у нас
// нет вовсе, поэтому 0.
type PaymentsStarGifts struct {
	Underscore string       `json:"_"`
	Hash       int          `json:"hash"`
	Gifts      []MTStarGift `json:"gifts"`
	Chats      []Chat       `json:"chats"`
	Users      []UserReal   `json:"users"`
}

// NewPaymentsStarGifts — каталог контейнером.
func NewPaymentsStarGifts(gifts []MTStarGift) PaymentsStarGifts {
	return PaymentsStarGifts{
		Underscore: PaymentsStarGiftsTag,
		Gifts:      orEmpty(gifts),
		Chats:      []Chat{},
		Users:      []UserReal{},
	}
}

// payments.savedStarGifts#95f389b1 flags:# count:int
// chat_notifications_enabled:flags.1?Bool gifts:Vector<SavedStarGift>
// next_offset:flags.0?string chats:Vector<Chat> users:Vector<User>
// = payments.SavedStarGifts;
//
// Подарки в профиле. Страницами они у нас не отдаются, поэтому `count` и есть
// длина вектора, а `next_offset` не производится.
type PaymentsSavedStarGifts struct {
	Underscore string          `json:"_"`
	Count      int             `json:"count"`
	Gifts      []SavedStarGift `json:"gifts"`
	Chats      []Chat          `json:"chats"`
	Users      []UserReal      `json:"users"`
}

// NewPaymentsSavedStarGifts — витрина профиля контейнером.
func NewPaymentsSavedStarGifts(gifts []SavedStarGift) PaymentsSavedStarGifts {
	return PaymentsSavedStarGifts{
		Underscore: PaymentsSavedStarGiftsTag,
		Count:      len(gifts),
		Gifts:      orEmpty(gifts),
		Chats:      []Chat{},
		Users:      []UserReal{},
	}
}
