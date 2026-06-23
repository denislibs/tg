// Package media stores media metadata and brokers presigned MinIO URLs.
package media

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")

type Media struct {
	ID          int64
	OwnerID     int64
	Bucket      string
	ObjectKey   string
	Mime        string
	Size        int64
	Width       int
	Height      int
	Duration    int
	BlurPreview []byte
	CreatedAt   time.Time
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

func (r *Repo) Create(ctx context.Context, m Media) (Media, error) {
	err := r.pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime, size, width, height, duration, blur_preview)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 RETURNING id, created_at`,
		m.OwnerID, m.Bucket, m.ObjectKey, m.Mime, m.Size, m.Width, m.Height, m.Duration, m.BlurPreview,
	).Scan(&m.ID, &m.CreatedAt)
	return m, err
}

func (r *Repo) GetByID(ctx context.Context, id int64) (Media, error) {
	var m Media
	err := r.pool.QueryRow(ctx,
		`SELECT id, owner_id, bucket, object_key, mime, size, width, height, duration, blur_preview, created_at
		 FROM media WHERE id=$1`, id).Scan(
		&m.ID, &m.OwnerID, &m.Bucket, &m.ObjectKey, &m.Mime, &m.Size,
		&m.Width, &m.Height, &m.Duration, &m.BlurPreview, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Media{}, ErrNotFound
	}
	return m, err
}
