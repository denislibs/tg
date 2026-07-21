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
	ErrTooLarge     = errors.New("file too large")
	ErrBadSize      = errors.New("invalid size")
	ErrForbidden    = errors.New("forbidden")
	ErrBadPart      = errors.New("invalid part index")
	ErrNoUpload     = errors.New("no chunked upload in progress")
	ErrMissingParts = errors.New("missing or non-contiguous parts")
)

const (
	// maxSize caps the legacy single-PUT path (PutContent). maxChunkedSize caps the
	// chunked/resumable path (assembled server-side via MinIO multipart), which is
	// raised well above the single-PUT limit. The per-part byte cap is enforced at
	// the HTTP layer (maxPartUpload).
	maxSize        = 100 << 20 // 100 MiB
	maxChunkedSize = 2 << 30   // 2 GiB
	maxParts       = 10000     // S3/MinIO multipart hard limit
	presignTTL     = 15 * time.Minute
)

// MediaRepo persists and loads media metadata.
type MediaRepo interface {
	Create(ctx context.Context, m domain.Media) (domain.Media, error)
	GetByID(ctx context.Context, id int64) (domain.Media, error) // domain.ErrNotFound if absent
	// UpdateProcessed records ffprobe dims/duration and the thumbnail key.
	UpdateProcessed(ctx context.Context, id int64, width, height, duration int, thumbKey string) error

	// SetUploadID sets the multipart upload id iff it is currently unset, and
	// returns the effective (winning) id — so concurrent first parts converge on a
	// single multipart upload.
	SetUploadID(ctx context.Context, id int64, uploadID string) (string, error)
	// SetUploadTotal records the declared part count (for the resume query).
	SetUploadTotal(ctx context.Context, id int64, total int) error
	// SavePart upserts a received part's stored ETag and size (idempotent re-upload).
	SavePart(ctx context.Context, mediaID int64, partIndex int, etag string, size int64) error
	// ReceivedParts lists the received part indices, ascending.
	ReceivedParts(ctx context.Context, mediaID int64) ([]int, error)
	// PartsForComplete lists received parts (index+ETag), ascending, for completion.
	PartsForComplete(ctx context.Context, mediaID int64) ([]UploadedPart, error)
	// UpdateFinalized records the actual size/dims/name after assembly.
	UpdateFinalized(ctx context.Context, id int64, size int64, width, height, duration int, fileName, mime string) error
	// ClearUpload removes all part rows and resets the multipart bookkeeping.
	ClearUpload(ctx context.Context, id int64) error
}

// UploadedPart identifies a stored multipart part for completion.
type UploadedPart struct {
	PartNumber int
	ETag       string
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

	// Server-side multipart upload (chunked/resumable path). Parts are assembled by
	// the storage on CompleteMultipart into a normal object at objectKey — so the
	// existing GetObject download path serves it unchanged.
	StartMultipart(ctx context.Context, objectKey, contentType string) (uploadID string, err error)
	PutPart(ctx context.Context, objectKey, uploadID string, partNumber int, r io.Reader, size int64) (etag string, err error)
	CompleteMultipart(ctx context.Context, objectKey, uploadID string, parts []UploadedPart) error
	AbortMultipart(ctx context.Context, objectKey, uploadID string) error
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

// FinalizeInput carries the final metadata the client reports once every chunk of
// a resumable upload has been received. Total is the expected part count (used to
// verify completeness).
type FinalizeInput struct {
	Mime     string
	Size     int64
	Total    int
	Width    int
	Height   int
	Duration int
	FileName string
}
