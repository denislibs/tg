package story

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// storyTTL is how long a posted story stays in the active feed.
const storyTTL = 24 * time.Hour

// Service is the stories application logic: posting (with media-ownership and
// privacy defaults), the per-viewer active feed, view tracking, the
// author-gated viewers list, and deletion. It depends only on ports.
type Service struct {
	repo     StoryRepo
	partners Partners
	media    MediaOwner
	tx       TxManager
}

// New constructs the story service from its ports.
func New(repo StoryRepo, partners Partners, media MediaOwner, tx TxManager) *Service {
	return &Service{repo: repo, partners: partners, media: media, tx: tx}
}

// Post creates a story for authorID from a media object they own. It rejects
// posting media owned by someone else (domain.ErrForbidden), defaults privacy
// to "contacts", sets a 24h expiry, and persists within a transaction (so the
// story row and any story_allow rows commit together).
func (s *Service) Post(ctx context.Context, authorID, mediaID int64, caption, privacy string, allowIDs []int64) (int64, error) {
	owner, err := s.media.OwnerID(ctx, mediaID)
	if err != nil {
		return 0, err
	}
	if owner != authorID {
		return 0, domain.ErrForbidden
	}
	if privacy == "" {
		privacy = "contacts"
	}
	story := domain.Story{
		AuthorID:  authorID,
		MediaID:   mediaID,
		Caption:   caption,
		Privacy:   privacy,
		ExpiresAt: time.Now().Add(storyTTL),
	}
	var id int64
	err = s.tx.WithinTx(ctx, func(ctx context.Context) error {
		var e error
		id, e = s.repo.Create(ctx, story, allowIDs)
		return e
	})
	return id, err
}

// Feed returns the active story groups visible to viewerID: their own stories
// plus those of their chat partners (privacy filtering happens in the repo).
func (s *Service) Feed(ctx context.Context, viewerID int64) ([]domain.StoryGroup, error) {
	partners, err := s.partners.ChatPartners(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	authorIDs := append(partners, viewerID)
	return s.repo.ActiveFeed(ctx, viewerID, authorIDs)
}

// View marks a story as seen by viewerID, but only if the story is visible to
// them (own/everyone/contacts-with-partner/selected-allow); otherwise it
// returns domain.ErrForbidden.
func (s *Service) View(ctx context.Context, storyID, viewerID int64) error {
	partners, err := s.partners.ChatPartners(ctx, viewerID)
	if err != nil {
		return err
	}
	ok, err := s.repo.Visible(ctx, storyID, viewerID, partners)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrForbidden
	}
	return s.repo.MarkViewed(ctx, storyID, viewerID)
}

// Viewers returns who has seen a story; only the story's author may read it
// (domain.ErrForbidden otherwise).
func (s *Service) Viewers(ctx context.Context, storyID, requesterID int64) ([]domain.UserCard, error) {
	author, err := s.repo.GetAuthor(ctx, storyID)
	if err != nil {
		return nil, err
	}
	if author != requesterID {
		return nil, domain.ErrForbidden
	}
	return s.repo.Viewers(ctx, storyID)
}

// Stats returns view statistics for a story; only the author may read them
// (domain.ErrForbidden otherwise, domain.ErrNotFound if the story is gone).
func (s *Service) Stats(ctx context.Context, storyID, requesterID int64) (domain.StoryStats, error) {
	author, err := s.repo.GetAuthor(ctx, storyID)
	if err != nil {
		return domain.StoryStats{}, err
	}
	if author != requesterID {
		return domain.StoryStats{}, domain.ErrForbidden
	}
	return s.repo.Stats(ctx, storyID)
}

// Delete removes a story owned by authorID.
func (s *Service) Delete(ctx context.Context, storyID, authorID int64) error {
	return s.repo.Delete(ctx, storyID, authorID)
}
