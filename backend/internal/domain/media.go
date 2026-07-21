package domain

import "time"

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
	// FileName is the original upload name (shown for documents/music).
	FileName string
	// ThumbKey is the object key of a server-generated thumbnail/poster (jpeg),
	// empty until processing completes (or for non-visual media).
	ThumbKey string
	// UploadID is the in-flight MinIO multipart upload id for a chunked/resumable
	// upload (empty when none is in progress or after finalize). UploadTotal is the
	// declared number of parts, surfaced by the resume query.
	UploadID    string
	UploadTotal int
	CreatedAt   time.Time
}
