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
	CreatedAt   time.Time
}
