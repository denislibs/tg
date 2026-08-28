package domain

import "time"

// Giveaway — розыгрыш в канале (Telegram giveaway). Хранится отдельно от
// сообщения; сообщение типа 'giveaway' ссылается на него через
// messages.giveaway_id (как poll_id для опросов).
type Giveaway struct {
	ID           int64
	ChatID       int64
	CreatorID    int64
	PrizeKind    string // "premium" | "stars"
	Months       int    // срок premium-подписки (PrizeKind == "premium")
	Stars        int64  // звёзд каждому победителю (PrizeKind == "stars")
	WinnersCount int
	UntilDate    time.Time
	// CreatedAt — когда розыгрыш ЗАПУЩЕН. Колонка giveaways.created_at
	// существовала с самого начала, но наружу не выходила: в схеме это
	// обязательный payments.giveawayInfo.start_date.
	CreatedAt time.Time
	Status    string // "active" | "finished"
	WinnerIDs []int64
}

// GiveawayInfo — представление розыгрыша для конкретного зрителя (read-модель).
// UntilDate/StartDate — unix-миллисекунды.
//
// json-тегов здесь нет: на провод уходят конструкторы схемы — условия розыгрыша
// вложением сообщения (GiveawayInfo.ToMedia), личное состояние зрителя ответом
// ручки (GiveawayInfo.ToState), см. mtgiveaway.go.
type GiveawayInfo struct {
	ID int64
	// PeerID — знаковый ключ канала розыгрыша (розыгрыши только в каналах).
	PeerID        PeerID
	PrizeKind     string
	Months        int
	Stars         int64
	WinnersCount  int
	UntilDate     int64
	StartDate     int64
	Status        string
	Participants  int
	Participating bool // зритель участвует
	WinnerIDs     []int64
	IWon          bool
}
