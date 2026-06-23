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

// CanAccess reports whether userID may download a media object: either they own
// it, or they are a member of a chat that has a message referencing it.
func (r *MediaAccessRepo) CanAccess(ctx context.Context, userID, mediaID int64) (bool, error) {
	q := querier(ctx, r.pool)
	var allowed bool
	err := q.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM media WHERE id=$1 AND owner_id=$2
		   UNION ALL
		   SELECT 1 FROM messages m
		     JOIN chat_members cm ON cm.chat_id = m.chat_id
		     WHERE m.media_id=$1 AND cm.user_id=$2
		 )`, mediaID, userID).Scan(&allowed)
	return allowed, err
}
