package domain

type ReactionCount struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	// Mine — зритель тоже поставил эту реакцию (клиент подсвечивает чип).
	Mine bool `json:"mine,omitempty"`
}

// ReactionUser — одна поставленная реакция (кто и каким эмодзи), для попапа
// «кто отреагировал». User несёт карточку для отображения (имя/аватар).
type ReactionUser struct {
	User  UserCard
	Emoji string
}
