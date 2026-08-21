package domain

import "time"

// StarGift — строка каталога подарков (таблица star_gifts): что можно подарить
// за звёзды. Ограниченный подарок несёт остаток (Remains) и флаг SoldOut.
// Total/Remains == nil у безлимитных.
//
// Read-модель, НА ПРОВОД НЕ ВЫХОДИТ: и лента, и витрина профиля, и каталог
// отдают её конструктором схемы starGift (NewStarGift, mtgift.go), поэтому
// json-тегов здесь нет — ровно как у GiftInfo ниже.
type StarGift struct {
	ID           int64
	Emoji        string
	Title        string
	PriceStars   int64
	ConvertStars int64
	Total        *int64
	Remains      *int64
	SoldOut      bool
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

// GiftInfo — выданный подарок: экземпляр StarGift, полученный пользователем.
// Read-модель для зрителя; на провод уходит конструкторами схемы — действием
// messageActionStarGift в ленте и savedStarGift в витрине профиля (mtgift.go),
// поэтому json-тегов здесь нет.
//
// FromID — кто подарил (nil у анонимного, если смотрит не владелец). Hidden —
// скрыт из профиля, Converted — обменян на звёзды.
//
// Имени дарителя строкой здесь БОЛЬШЕ НЕТ: его собирает клиент из FromID, как
// после порта пиров собирает любое другое имя.
type GiftInfo struct {
	ID int64
	// OwnerID — чей это подарок. В схеме — messageActionStarGift.peer, парой с
	// saved_id: адрес подарка это «чей профиль» + «какой из подарков».
	OwnerID      int64
	Gift         StarGift
	FromID       *int64
	Message      string
	Anonymous    bool
	Hidden       bool
	Converted    bool
	ConvertStars int64
	Date         time.Time
}
