package story

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// StoryRepo is the persistence port for stories: post, the active feed read
// model (with privacy/visibility filtering and per-viewer seen state), view
// tracking, viewers list, author lookup, deletion, and a single-story
// visibility check.
type StoryRepo interface {
	Create(ctx context.Context, s domain.Story, allowIDs []int64) (int64, error)
	ActiveFeed(ctx context.Context, viewerID int64, authorIDs []int64) ([]domain.StoryGroup, error)
	MarkViewed(ctx context.Context, storyID, viewerID int64) error
	Viewers(ctx context.Context, storyID int64) ([]domain.UserCard, error)
	GetAuthor(ctx context.Context, storyID int64) (int64, error) // domain.ErrNotFound
	Delete(ctx context.Context, storyID, authorID int64) error
	Visible(ctx context.Context, storyID, viewerID int64, partnerIDs []int64) (bool, error)
}
