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

// GiftInfo — выданный подарок (savedStarGift): экземпляр StarGift, полученный
// пользователем. From — кто подарил (nil у анонимного/системного). Hidden —
// скрыт из профиля, Converted — обменян на звёзды. Read-модель для зрителя.
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
}
