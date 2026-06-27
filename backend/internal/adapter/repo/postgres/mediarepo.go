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
		`INSERT INTO media (owner_id, bucket, object_key, mime, size, width, height, duration, blur_preview, file_name)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 RETURNING id, created_at`,
		m.OwnerID, m.Bucket, m.ObjectKey, m.Mime, m.Size, m.Width, m.Height, m.Duration, m.BlurPreview, m.FileName,
	).Scan(&m.ID, &m.CreatedAt)
	return m, err
}

func (r *MediaRepo) GetByID(ctx context.Context, id int64) (domain.Media, error) {
	q := querier(ctx, r.pool)
	var m domain.Media
	err := q.QueryRow(ctx,
		`SELECT id, owner_id, bucket, object_key, mime, size, width, height, duration, blur_preview, file_name, thumb_key, created_at
		 FROM media WHERE id=$1`, id).Scan(
		&m.ID, &m.OwnerID, &m.Bucket, &m.ObjectKey, &m.Mime, &m.Size,
		&m.Width, &m.Height, &m.Duration, &m.BlurPreview, &m.FileName, &m.ThumbKey, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Media{}, domain.ErrNotFound
	}
	return m, err
}

// UpdateProcessed records server-side processing results (ffprobe dims/duration
// and the generated thumbnail/poster key). Zero/empty values are left as-is so a
// probe that only learns dimensions doesn't clobber an existing thumb.
func (r *MediaRepo) UpdateProcessed(ctx context.Context, id int64, width, height, duration int, thumbKey string) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`UPDATE media SET
		   width     = CASE WHEN $2 > 0 THEN $2 ELSE width END,
		   height    = CASE WHEN $3 > 0 THEN $3 ELSE height END,
		   duration  = CASE WHEN $4 > 0 THEN $4 ELSE duration END,
		   thumb_key = CASE WHEN $5 <> '' THEN $5 ELSE thumb_key END
		 WHERE id=$1`,
		id, width, height, duration, thumbKey)
	return err
}
