package domain

// StarGift — позиция каталога подарков (Telegram star gift): что можно
// подарить за звёзды. Ограниченный подарок несёт остаток (Remains) и флаг
// SoldOut. Total/Remains == nil у безлимитных.
type StarGift struct {
	ID           int64  `json:"id"`
	Emoji        string `json:"emoji"`
	Title        string `json:"title"`
	PriceStars   int64  `json:"price_stars"`
	ConvertStars int64  `json:"convert_stars"`
	Total        *int64 `json:"total,omitempty"`
	Remains      *int64 `json:"remains,omitempty"`
	SoldOut      bool   `json:"sold_out"`
}

// StarTransaction — движение баланса звёзд (Telegram Stars wallet history).
// Amount со знаком: + начисление (пополнение/обмен подарка), − списание
// (подарок/платное медиа). Kind — тип операции, PeerID — контрагент (nil, если
// его нет). Date — RFC3339.
type StarTransaction struct {
	ID     int64  `json:"id"`
	Amount int64  `json:"amount"`
	Kind   string `json:"kind"`
	Title  string `json:"title,omitempty"`
	PeerID *int64 `json:"peer_id,omitempty"`
	Date   string `json:"date"`
}

// GiftInfo — выданный подарок (savedStarGift): экземпляр StarGift, полученный
// пользователем. From — кто подарил (nil у анонимного/системного). Hidden —
// скрыт из профиля, Converted — обменян на звёзды. Date — когда подарен
// (RFC3339). Read-модель для зрителя.
type GiftInfo struct {
	ID           int64    `json:"id"`
	Gift         StarGift `json:"gift"`
	FromID       *int64   `json:"from_id,omitempty"`
	FromName     string   `json:"from_name,omitempty"`
	Message      string   `json:"message,omitempty"`
	Anonymous    bool     `json:"anonymous"`
	Hidden       bool     `json:"hidden"`
	Converted    bool     `json:"converted"`
	ConvertStars int64    `json:"convert_stars"`
	Date         string   `json:"date,omitempty"`
}
