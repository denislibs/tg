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
	ThumbKey  string
	CreatedAt time.Time
}
