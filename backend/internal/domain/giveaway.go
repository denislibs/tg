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
	Status       string // "active" | "finished"
	WinnerIDs    []int64
}

// GiveawayInfo — представление розыгрыша для конкретного зрителя (read-модель):
// уходит клиенту как msg.Giveaway. UntilDate — unix-миллисекунды.
type GiveawayInfo struct {
	ID            int64   `json:"id"`
	ChatID        int64   `json:"chat_id"`
	PrizeKind     string  `json:"prize_kind"`
	Months        int     `json:"months"`
	Stars         int64   `json:"stars"`
	WinnersCount  int     `json:"winners_count"`
	UntilDate     int64   `json:"until_date"`
	Status        string  `json:"status"`
	Participants  int     `json:"participants"`
	Participating bool    `json:"participating"` // зритель участвует
	WinnerIDs     []int64 `json:"winner_ids,omitempty"`
	IWon          bool    `json:"i_won"`
}
