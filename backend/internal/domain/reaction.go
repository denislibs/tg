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

// StarReactionAgg — агрегат платной ⭐-реакции сообщения для зрителя: суммарное
// число звёзд (Total) и личный вклад зрителя (Mine). Наполняется read-моделью
// истории (не хранится на строке сообщения). Total==0 — платных реакций нет.
type StarReactionAgg struct {
	Total int64 `json:"total"`
	Mine  int64 `json:"mine,omitempty"`
}

// StarReactionSender — один отправитель платной ⭐-реакции (топ-отправители у
// бабла/в попапе). Anonymous скрывает личность: карточку зрителю не раскрываем.
type StarReactionSender struct {
	User      UserCard
	Stars     int64
	Anonymous bool
}
