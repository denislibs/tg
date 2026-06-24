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

// Partners resolves the set of users that share a chat with a viewer; satisfied
// by the chat usecase's ChatPartners.
type Partners interface {
	ChatPartners(ctx context.Context, userID int64) ([]int64, error)
}

// MediaOwner resolves the owner of a media object; satisfied by the postgres
// MediaAccessRepo.
type MediaOwner interface {
	OwnerID(ctx context.Context, mediaID int64) (int64, error)
}

// TxManager runs fn inside a transaction; the tx is carried in the returned ctx
// (repo adapters pick it up). Same shape as the chat usecase's TxManager.
type TxManager interface {
	WithinTx(ctx context.Context, fn func(ctx context.Context) error) error
}
