package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// MediaRepo is a postgres-backed adapter implementing the media usecase's
// MediaRepo port. It stores media metadata; the bytes live in object storage.
type MediaRepo struct{ pool *pgxpool.Pool }

var _ usecasemedia.MediaRepo = (*MediaRepo)(nil)

func NewMediaRepo(pool *pgxpool.Pool) *MediaRepo { return &MediaRepo{pool: pool} }

func (r *MediaRepo) Create(ctx context.Context, m domain.Media) (domain.Media, error) {
	q := querier(ctx, r.pool)
	err := q.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime, size, width, height, duration, blur_preview)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 RETURNING id, created_at`,
		m.OwnerID, m.Bucket, m.ObjectKey, m.Mime, m.Size, m.Width, m.Height, m.Duration, m.BlurPreview,
	).Scan(&m.ID, &m.CreatedAt)
	return m, err
}

func (r *MediaRepo) GetByID(ctx context.Context, id int64) (domain.Media, error) {
	q := querier(ctx, r.pool)
	var m domain.Media
	err := q.QueryRow(ctx,
		`SELECT id, owner_id, bucket, object_key, mime, size, width, height, duration, blur_preview, created_at
		 FROM media WHERE id=$1`, id).Scan(
		&m.ID, &m.OwnerID, &m.Bucket, &m.ObjectKey, &m.Mime, &m.Size,
		&m.Width, &m.Height, &m.Duration, &m.BlurPreview, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Media{}, domain.ErrNotFound
	}
	return m, err
}
