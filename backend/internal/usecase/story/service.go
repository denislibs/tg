package story

import (
	"context"
	"encoding/json"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// defaultTTL is the fallback story lifetime when the caller does not choose a
// valid period.
const defaultTTL = 24 * time.Hour

// maxReactionLen bounds a reaction emoji (same limit as chat message reactions).
const maxReactionLen = 32

// maxCaptionRunes caps a story caption length (counted in runes), matching
// Telegram's story caption limit.
const maxCaptionRunes = 2048

// allowedPeriods are the story lifetimes a client may pick (seconds): 6h/12h/24h/48h.
var allowedPeriods = map[int64]bool{21600: true, 43200: true, 86400: true, 172800: true}

// Service is the stories application logic: posting (with media-ownership,
// privacy defaults and a chosen lifetime), the per-viewer active feed, view
// tracking, reactions, the author-gated viewers list/stats, and deletion. It
// depends only on ports; realtime fan-out goes through an optional publisher.
type Service struct {
	repo      StoryRepo
	partners  Partners
	media     MediaOwner
	tx        TxManager
	publisher EventPublisher
}

// New constructs the story service from its ports.
func New(repo StoryRepo, partners Partners, media MediaOwner, tx TxManager) *Service {
	return &Service{repo: repo, partners: partners, media: media, tx: tx}
}

// SetPublisher attaches a realtime publisher (optional). When nil, story events
// are simply not broadcast (clients still poll GET /stories).
func (s *Service) SetPublisher(p EventPublisher) { s.publisher = p }

// ttlFor maps a requested lifetime (seconds) to a duration, falling back to 24h
// for zero/invalid values.
func ttlFor(period int64) time.Duration {
	if allowedPeriods[period] {
		return time.Duration(period) * time.Second
	}
	return defaultTTL
}

// Post creates a story for authorID from a media object they own. It rejects
// posting media owned by someone else (domain.ErrForbidden), defaults privacy
// to "contacts", sets expiry to now+period (6h/12h/24h/48h; 24h default), and
// persists within a transaction (so the story row and any story_allow rows
// commit together). On success it broadcasts a story_new frame to the viewers
// the story is visible to.
func (s *Service) Post(ctx context.Context, authorID, mediaID int64, caption, privacy string, allowIDs []int64, period int64) (int64, error) {
	owner, err := s.media.OwnerID(ctx, mediaID)
	if err != nil {
		return 0, err
	}
	if owner != authorID {
		return 0, domain.ErrForbidden
	}
	if utf8.RuneCountInString(caption) > maxCaptionRunes {
		return 0, domain.ErrTooLong
	}
	if privacy == "" {
		privacy = "contacts"
	}
	story := domain.Story{
		AuthorID:  authorID,
		MediaID:   mediaID,
		Caption:   caption,
		Privacy:   privacy,
		ExpiresAt: time.Now().Add(ttlFor(period)),
	}
	var id int64
	err = s.tx.WithinTx(ctx, func(ctx context.Context) error {
		var e error
		id, e = s.repo.Create(ctx, story, allowIDs)
		return e
	})
	if err != nil {
		return 0, err
	}
	story.ID = id
	s.broadcast(ctx, s.recipients(ctx, authorID, privacy, allowIDs), frame("story_new", map[string]any{
		"id": id, "author_id": authorID, "media_id": mediaID,
		"caption": caption, "expires_at": story.ExpiresAt,
	}))
	return id, nil
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
	ok, err := s.canSee(ctx, storyID, viewerID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrForbidden
	}
	return s.repo.MarkViewed(ctx, storyID, viewerID)
}

// SetReaction sets or replaces the viewer's reaction on a story they can see
// (upsert). It returns domain.ErrForbidden when the story is not visible to the
// viewer and domain.ErrBadReaction for an empty/oversized/invalid emoji. On
// success it publishes a story_reaction frame to the story's author.
func (s *Service) SetReaction(ctx context.Context, storyID, userID int64, reaction string) error {
	if reaction == "" || len(reaction) > maxReactionLen || !utf8.ValidString(reaction) {
		return domain.ErrBadReaction
	}
	ok, err := s.canSee(ctx, storyID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrForbidden
	}
	if err := s.repo.SetReaction(ctx, storyID, userID, reaction); err != nil {
		return err
	}
	s.notifyReaction(ctx, storyID, userID, reaction)
	return nil
}

// RemoveReaction clears the viewer's reaction on a story they can see. It
// publishes a story_reaction frame (reaction:null) to the story's author.
func (s *Service) RemoveReaction(ctx context.Context, storyID, userID int64) error {
	ok, err := s.canSee(ctx, storyID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrForbidden
	}
	if err := s.repo.RemoveReaction(ctx, storyID, userID); err != nil {
		return err
	}
	s.notifyReaction(ctx, storyID, userID, "")
	return nil
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

// Stats returns view/reaction statistics for a story; only the author may read
// them (domain.ErrForbidden otherwise, domain.ErrNotFound if the story is gone).
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

// Delete removes a story owned by authorID and broadcasts a story_deleted frame
// to the author plus their chat partners (the Feed visibility set). It verifies
// ownership first (like Viewers/Stats via GetAuthor): a missing story yields
// domain.ErrNotFound and a non-owner domain.ErrForbidden — in both cases nothing
// is deleted and no event is broadcast.
func (s *Service) Delete(ctx context.Context, storyID, authorID int64) error {
	author, err := s.repo.GetAuthor(ctx, storyID)
	if err != nil {
		return err // domain.ErrNotFound when the story is gone
	}
	if author != authorID {
		return domain.ErrForbidden
	}
	if err := s.repo.Delete(ctx, storyID, authorID); err != nil {
		return err
	}
	partners, err := s.partners.ChatPartners(ctx, authorID)
	if err != nil {
		return nil // deletion succeeded; skip fan-out if partners can't be resolved
	}
	s.broadcast(ctx, append(partners, authorID), frame("story_deleted", map[string]any{
		"story_id": storyID, "author_id": authorID,
	}))
	return nil
}

// canSee reports whether viewerID may see storyID under the current privacy
// rules (own/everyone/contacts-with-partner/selected-allow).
func (s *Service) canSee(ctx context.Context, storyID, viewerID int64) (bool, error) {
	partners, err := s.partners.ChatPartners(ctx, viewerID)
	if err != nil {
		return false, err
	}
	return s.repo.Visible(ctx, storyID, viewerID, partners)
}

// recipients returns the users a freshly posted story is visible to: the author
// plus, for everyone/contacts, their chat partners, or, for selected, the
// explicit allowlist.
func (s *Service) recipients(ctx context.Context, authorID int64, privacy string, allowIDs []int64) []int64 {
	if privacy == "selected" {
		return append(allowIDs, authorID)
	}
	partners, err := s.partners.ChatPartners(ctx, authorID)
	if err != nil {
		return []int64{authorID}
	}
	return append(partners, authorID)
}

// notifyReaction publishes a story_reaction frame (with the fresh total) to the
// story's author. reaction=="" means the viewer removed their reaction.
func (s *Service) notifyReaction(ctx context.Context, storyID, userID int64, reaction string) {
	if s.publisher == nil {
		return
	}
	author, err := s.repo.GetAuthor(ctx, storyID)
	if err != nil {
		return
	}
	count, err := s.repo.ReactionsCount(ctx, storyID)
	if err != nil {
		return
	}
	var r any
	if reaction != "" {
		r = reaction
	}
	_ = s.publisher.PublishToUser(ctx, author, frame("story_reaction", map[string]any{
		"story_id": storyID, "user_id": userID,
		"reaction": r, "reactions_count": count,
	}))
}

// broadcast sends frame to each recipient (deduplicated) when a publisher is set.
func (s *Service) broadcast(ctx context.Context, userIDs []int64, f []byte) {
	if s.publisher == nil || f == nil {
		return
	}
	seen := make(map[int64]struct{}, len(userIDs))
	for _, uid := range userIDs {
		if _, dup := seen[uid]; dup {
			continue
		}
		seen[uid] = struct{}{}
		_ = s.publisher.PublishToUser(ctx, uid, f)
	}
}

// frame encodes a WS envelope {t, d}; empty on the unreachable marshal error.
func frame(t string, d any) []byte {
	b, err := json.Marshal(map[string]any{"t": t, "d": d})
	if err != nil {
		return nil
	}
	return b
}
