package domain

type ReactionCount struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	// Mine — зритель тоже поставил эту реакцию (клиент подсвечивает чип).
	Mine bool `json:"mine,omitempty"`
	// RecentUserIDs — id последних реагировавших (до 3, свежие первыми). Клиент
	// показывает их аватары вместо числа при count<4 (tweb reaction.ts:1060-1084,
	// reactions.ts:305-307 — аватары при totalReactions<REACTIONS_DISPLAY_COUNTER_AT).
	RecentUserIDs []int64 `json:"recent_user_ids,omitempty"`
}

// ReactionUser — одна поставленная реакция (кто и каким эмодзи), для попапа
// «кто отреагировал». User несёт карточку для отображения (имя/аватар).
type ReactionUser struct {
	User  UserCard
	Emoji string
}

// SavedTag — тег-реакция «Избранного» (Telegram saved reaction tag): реакция
// (эмодзи или id кастом-эмодзи как строка), заданное пользователем имя (может
// быть пустым) и число помеченных этим тегом сообщений в самочате.
type SavedTag struct {
	Reaction string `json:"reaction"`
	Title    string `json:"title,omitempty"`
	Count    int    `json:"count"`
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
