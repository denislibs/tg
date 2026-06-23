package media

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

const presignTTL = 15 * time.Minute

// ErrTooLarge is returned when the declared size exceeds the limit.
var ErrTooLarge = errors.New("file too large")

// ErrBadSize is returned for a non-positive declared size.
var ErrBadSize = errors.New("invalid size")

const maxSize = 100 << 20 // 100 MiB

// Storage is the subset of miniostore.Client the service needs.
type Storage interface {
	Bucket() string
	PresignedPut(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
	PresignedGet(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
}

type Service struct {
	repo    *Repo
	storage Storage
}

func NewService(repo *Repo, storage Storage) *Service {
	return &Service{repo: repo, storage: storage}
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

// CreateUpload records media metadata and returns the row plus a presigned PUT
// URL the client uploads the bytes to directly.
func (s *Service) CreateUpload(ctx context.Context, in UploadInput) (Media, string, error) {
	if in.Size <= 0 {
		return Media{}, "", ErrBadSize
	}
	if in.Size > maxSize {
		return Media{}, "", ErrTooLarge
	}
	objectKey := fmt.Sprintf("%d/%s", in.OwnerID, randomKey())
	m, err := s.repo.Create(ctx, Media{
		OwnerID: in.OwnerID, Bucket: s.storage.Bucket(), ObjectKey: objectKey,
		Mime: in.Mime, Size: in.Size, Width: in.Width, Height: in.Height,
		Duration: in.Duration, BlurPreview: in.BlurPreview,
	})
	if err != nil {
		return Media{}, "", err
	}
	uploadURL, err := s.storage.PresignedPut(ctx, objectKey, presignTTL)
	if err != nil {
		return Media{}, "", err
	}
	return m, uploadURL, nil
}

// GetMedia returns a media row and a presigned GET (download) URL.
func (s *Service) GetMedia(ctx context.Context, id int64) (Media, string, error) {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return Media{}, "", err
	}
	downloadURL, err := s.storage.PresignedGet(ctx, m.ObjectKey, presignTTL)
	if err != nil {
		return Media{}, "", err
	}
	return m, downloadURL, nil
}

func randomKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
