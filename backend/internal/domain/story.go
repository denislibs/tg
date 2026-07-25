package domain

import "time"

// Story is a full stories row.
type Story struct {
	ID, AuthorID, MediaID int64
	Caption, Privacy      string
	CreatedAt, ExpiresAt  time.Time
	// Pinned — история закреплена в профиле (показывается всегда, в т.ч. истёкшая).
	// Edited — история редактировалась после публикации (флаг edited в tweb).
	Pinned, Edited bool
}

// StoryItem is one story in a feed group, with the viewer's seen state and its
// reaction aggregate for the viewer (tweb story views.reactions / sent_reaction).
type StoryItem struct {
	ID, MediaID int64
	Caption     string
	// Privacy отдаётся как есть, чтобы фронт показал иконку (close friends и т.п.).
	Privacy   string
	CreatedAt time.Time
	ExpiresAt time.Time
	Viewed    bool
	// Pinned/Edited — состояние жизненного цикла истории (закреп в профиле / правка).
	Pinned, Edited bool
	// ReactionsCount — всего реакций на историю; MyReaction — эмодзи текущего
	// зрителя ("" = не реагировал); Reactions — разбивка эмодзи→count.
	ReactionsCount int
	MyReaction     string
	Reactions      []ReactionCount
	// AllowIDs — явный allow-лист истории с privacy=="selected". Заполняется
	// только для собственных историй зрителя (автор==зритель), чтобы автор мог
	// отредактировать аудиторию; для чужих историй остаётся nil (не раскрываем).
	AllowIDs []int64
}

// StoryGroup bundles an author's active stories for the feed read model.
type StoryGroup struct {
	Author  UserCard
	Stories []StoryItem
}

// StealthMode — эфемерное состояние «невидимого просмотра» историй пользователя
// (tweb stories.stealthMode: active_until_date / cooldown_until_date). Пока
// now < ActiveUntil, просмотры зрителя не записываются; повторно активировать
// режим можно только после CooldownUntil.
type StealthMode struct {
	ActiveUntil   time.Time
	CooldownUntil time.Time
}
