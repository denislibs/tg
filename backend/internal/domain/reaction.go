package domain

type ReactionCount struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	// Mine — зритель тоже поставил эту реакцию (клиент подсвечивает чип).
	Mine bool `json:"mine,omitempty"`
}
