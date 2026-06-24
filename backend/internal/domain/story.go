package domain

import "time"

// Story is a full stories row.
type Story struct {
	ID, AuthorID, MediaID int64
	Caption, Privacy      string
	CreatedAt, ExpiresAt  time.Time
}

// StoryItem is one story in a feed group, with the viewer's seen state.
type StoryItem struct {
	ID, MediaID int64
	Caption     string
	CreatedAt   time.Time
	Viewed      bool
}

// StoryGroup bundles an author's active stories for the feed read model.
type StoryGroup struct {
	Author  UserCard
	Stories []StoryItem
}
