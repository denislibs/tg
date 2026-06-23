// Package media is the media usecase: it records media metadata and brokers
// presigned object-storage URLs.
package media

import (
	"context"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// ErrTooLarge is returned when the declared size exceeds the limit.
// ErrBadSize is returned for a non-positive declared size.
var (
	ErrTooLarge = errors.New("file too large")
	ErrBadSize  = errors.New("invalid size")
)

const (
	maxSize    = 100 << 20 // 100 MiB
	presignTTL = 15 * time.Minute
)

// MediaRepo persists and loads media metadata.
type MediaRepo interface {
	Create(ctx context.Context, m domain.Media) (domain.Media, error)
	GetByID(ctx context.Context, id int64) (domain.Media, error) // domain.ErrNotFound if absent
}

// ObjectStorage brokers presigned URLs against a bucket.
type ObjectStorage interface {
	Bucket() string
	PresignedPut(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
	PresignedGet(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
}

// UploadInput describes a media object the client is about to upload.
type UploadInput struct {
	OwnerID     int64
	Mime        string
	Size        int64
	Width       int
	Height      int
	Duration    int
	BlurPreview []byte
}
