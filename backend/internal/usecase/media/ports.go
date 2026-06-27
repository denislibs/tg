// Package media is the media usecase: it records media metadata and brokers
// presigned object-storage URLs.
package media

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// ErrTooLarge is returned when the declared size exceeds the limit.
// ErrBadSize is returned for a non-positive declared size.
var (
	ErrTooLarge  = errors.New("file too large")
	ErrBadSize   = errors.New("invalid size")
	ErrForbidden = errors.New("forbidden")
)

const (
	maxSize    = 100 << 20 // 100 MiB
	presignTTL = 15 * time.Minute
)

// MediaRepo persists and loads media metadata.
type MediaRepo interface {
	Create(ctx context.Context, m domain.Media) (domain.Media, error)
	GetByID(ctx context.Context, id int64) (domain.Media, error) // domain.ErrNotFound if absent
	// UpdateProcessed records ffprobe dims/duration and the thumbnail key.
	UpdateProcessed(ctx context.Context, id int64, width, height, duration int, thumbKey string) error
}

// ProcessResult is what the media processor extracts/produces from an original.
type ProcessResult struct {
	Width, Height, Duration int
	// Thumb is a generated jpeg thumbnail/poster (nil for non-visual media).
	Thumb []byte
}

// MediaProcessor probes and derives assets from an uploaded original (ffmpeg).
// Implementations must be safe to call from a background goroutine.
type MediaProcessor interface {
	Process(ctx context.Context, src io.Reader, mime string) (ProcessResult, error)
}

// ObjectInfo is the storage-level metadata needed to stream an object.
type ObjectInfo struct {
	Size        int64
	ContentType string
	ModTime     time.Time
}

// ObjectStorage brokers presigned URLs against a bucket.
type ObjectStorage interface {
	Bucket() string
	PresignedPut(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
	PresignedGet(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
	PutObject(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) error
	GetObject(ctx context.Context, objectKey string) (io.ReadSeekCloser, ObjectInfo, error)
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
	FileName    string
}
