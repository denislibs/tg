package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// MediaAccessRepo is a postgres-backed adapter implementing the chat usecase's MediaAccessRepo port.
type MediaAccessRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.MediaAccessRepo = (*MediaAccessRepo)(nil)

func NewMediaAccessRepo(pool *pgxpool.Pool) *MediaAccessRepo { return &MediaAccessRepo{pool: pool} }

// OwnerID returns the owner of a media object, or domain.ErrNotFound if absent.
func (r *MediaAccessRepo) OwnerID(ctx context.Context, mediaID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var ownerID int64
	err := q.QueryRow(ctx, `SELECT owner_id FROM media WHERE id=$1`, mediaID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return ownerID, err
}

// CanAccess reports whether userID may download a media object. Access is granted if any holds:
//   - they own it;
//   - they are a member of a chat that has a message referencing it;
//   - the media backs an active story they may view — i.e. they authored it, or
//     they are a chat partner of the author and the story is 'everyone'/'contacts',
//     or the story is 'selected' and they are on its allowlist.
//
// The story branch mirrors the visibility predicate used by the stories feed
// (see StoryRepo.ActiveFeed) so a viewer who can see a story can fetch its media.
func (r *MediaAccessRepo) CanAccess(ctx context.Context, userID, mediaID int64) (bool, error) {
	q := querier(ctx, r.pool)
	var allowed bool
	err := q.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM media WHERE id=$1 AND owner_id=$2
		   UNION ALL
		   -- avatars are visible to any authenticated user (the media id is some
		   -- user's current avatar)
		   SELECT 1 FROM users WHERE avatar_url = '/media/' || $1 || '/content'
		   UNION ALL
		   SELECT 1 FROM messages m
		     JOIN chat_members cm ON cm.chat_id = m.chat_id
		     WHERE m.media_id=$1 AND cm.user_id=$2
		   UNION ALL
		   SELECT 1 FROM stories s
		     WHERE s.media_id=$1 AND s.expires_at > now()
		       AND (
		         s.author_id = $2
		         OR (
		           EXISTS(
		             SELECT 1 FROM chat_members cm1
		               JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id = s.author_id
		             WHERE cm1.user_id = $2
		           )
		           AND (
		             s.privacy IN ('everyone','contacts')
		             OR EXISTS(SELECT 1 FROM story_allow sa WHERE sa.story_id = s.id AND sa.user_id = $2)
		           )
		         )
		       )
		 )`, mediaID, userID).Scan(&allowed)
	return allowed, err
}
