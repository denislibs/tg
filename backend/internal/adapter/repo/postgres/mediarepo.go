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
		`SELECT id, owner_id, bucket, object_key, mime, size, width, height, duration, blur_preview, file_name, thumb_key, upload_id, upload_total, created_at
		 FROM media WHERE id=$1`, id).Scan(
		&m.ID, &m.OwnerID, &m.Bucket, &m.ObjectKey, &m.Mime, &m.Size,
		&m.Width, &m.Height, &m.Duration, &m.BlurPreview, &m.FileName, &m.ThumbKey, &m.UploadID, &m.UploadTotal, &m.CreatedAt)
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

// SetUploadID sets the multipart upload id only if it is currently unset, and
// returns the effective id — so concurrent first parts of a resumable upload
// converge on one multipart upload (the loser reads the winner's id).
func (r *MediaRepo) SetUploadID(ctx context.Context, id int64, uploadID string) (string, error) {
	q := querier(ctx, r.pool)
	var winner string
	err := q.QueryRow(ctx,
		`UPDATE media SET upload_id=$2 WHERE id=$1 AND upload_id='' RETURNING upload_id`,
		id, uploadID).Scan(&winner)
	if errors.Is(err, pgx.ErrNoRows) {
		err = q.QueryRow(ctx, `SELECT upload_id FROM media WHERE id=$1`, id).Scan(&winner)
	}
	return winner, err
}

func (r *MediaRepo) SetUploadTotal(ctx context.Context, id int64, total int) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx, `UPDATE media SET upload_total=$2 WHERE id=$1`, id, total)
	return err
}

// SavePart upserts a received part; re-uploading a part index overwrites its ETag.
func (r *MediaRepo) SavePart(ctx context.Context, mediaID int64, partIndex int, etag string, size int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`INSERT INTO media_upload_parts (media_id, part_index, etag, size)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (media_id, part_index) DO UPDATE SET etag=EXCLUDED.etag, size=EXCLUDED.size`,
		mediaID, partIndex, etag, size)
	return err
}

func (r *MediaRepo) ReceivedParts(ctx context.Context, mediaID int64) ([]int, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT part_index FROM media_upload_parts WHERE media_id=$1 ORDER BY part_index`, mediaID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var idx int
		if err := rows.Scan(&idx); err != nil {
			return nil, err
		}
		out = append(out, idx)
	}
	return out, rows.Err()
}

func (r *MediaRepo) PartsForComplete(ctx context.Context, mediaID int64) ([]usecasemedia.UploadedPart, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT part_index, etag FROM media_upload_parts WHERE media_id=$1 ORDER BY part_index`, mediaID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []usecasemedia.UploadedPart
	for rows.Next() {
		var p usecasemedia.UploadedPart
		if err := rows.Scan(&p.PartNumber, &p.ETag); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpdateFinalized records the actual size/dims/name/mime once assembly succeeds.
func (r *MediaRepo) UpdateFinalized(ctx context.Context, id int64, size int64, width, height, duration int, fileName, mime string) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`UPDATE media SET
		   size      = CASE WHEN $2 > 0  THEN $2 ELSE size END,
		   width     = CASE WHEN $3 > 0  THEN $3 ELSE width END,
		   height    = CASE WHEN $4 > 0  THEN $4 ELSE height END,
		   duration  = CASE WHEN $5 > 0  THEN $5 ELSE duration END,
		   file_name = CASE WHEN $6 <> '' THEN $6 ELSE file_name END,
		   mime      = CASE WHEN $7 <> '' THEN $7 ELSE mime END
		 WHERE id=$1`,
		id, size, width, height, duration, fileName, mime)
	return err
}

// ClearUpload removes the part rows and resets the multipart bookkeeping. The
// part rows also cascade on media delete; this is the post-finalize cleanup.
func (r *MediaRepo) ClearUpload(ctx context.Context, id int64) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx, `DELETE FROM media_upload_parts WHERE media_id=$1`, id); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `UPDATE media SET upload_id='', upload_total=0 WHERE id=$1`, id)
	return err
}
