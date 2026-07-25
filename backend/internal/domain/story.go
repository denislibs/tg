package domain

import "time"

// Story is a full stories row.
type Story struct {
	ID, AuthorID, MediaID int64
	Caption, Privacy      string
	CreatedAt, ExpiresAt  time.Time
}

// StoryItem is one story in a feed group, with the viewer's seen state and its
// reaction aggregate for the viewer (tweb story views.reactions / sent_reaction).
type StoryItem struct {
	ID, MediaID int64
	Caption     string
	CreatedAt   time.Time
	Viewed      bool
	// ReactionsCount — всего реакций на историю; MyReaction — эмодзи текущего
	// зрителя ("" = не реагировал); Reactions — разбивка эмодзи→count.
	ReactionsCount int
	MyReaction     string
	Reactions      []ReactionCount
}

// StoryGroup bundles an author's active stories for the feed read model.
type StoryGroup struct {
	Author  UserCard
	Stories []StoryItem
}
