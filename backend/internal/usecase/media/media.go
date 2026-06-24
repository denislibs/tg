package media

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"

	"github.com/messenger-denis/backend/internal/domain"
)

// Interactor implements the media usecase over a MediaRepo and ObjectStorage.
type Interactor struct {
	repo    MediaRepo
	storage ObjectStorage
}

func New(repo MediaRepo, storage ObjectStorage) *Interactor {
	return &Interactor{repo: repo, storage: storage}
}

// CreateUpload records media metadata and returns the row plus a presigned PUT
// URL the client uploads the bytes to directly.
func (s *Interactor) CreateUpload(ctx context.Context, in UploadInput) (domain.Media, string, error) {
	if in.Size <= 0 {
		return domain.Media{}, "", ErrBadSize
	}
	if in.Size > maxSize {
		return domain.Media{}, "", ErrTooLarge
	}
	objectKey := fmt.Sprintf("%d/%s", in.OwnerID, randomKey())
	m, err := s.repo.Create(ctx, domain.Media{
		OwnerID: in.OwnerID, Bucket: s.storage.Bucket(), ObjectKey: objectKey,
		Mime: in.Mime, Size: in.Size, Width: in.Width, Height: in.Height,
		Duration: in.Duration, BlurPreview: in.BlurPreview,
	})
	if err != nil {
		return domain.Media{}, "", err
	}
	uploadURL, err := s.storage.PresignedPut(ctx, objectKey, presignTTL)
	if err != nil {
		return domain.Media{}, "", err
	}
	return m, uploadURL, nil
}

// GetMedia returns a media row and a presigned GET (download) URL.
func (s *Interactor) GetMedia(ctx context.Context, id int64) (domain.Media, string, error) {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return domain.Media{}, "", err
	}
	downloadURL, err := s.storage.PresignedGet(ctx, m.ObjectKey, presignTTL)
	if err != nil {
		return domain.Media{}, "", err
	}
	return m, downloadURL, nil
}

// PutContent streams uploaded bytes into the media object. Only the owner may upload.
func (s *Interactor) PutContent(ctx context.Context, id, ownerID int64, r io.Reader, size int64) error {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if m.OwnerID != ownerID {
		return ErrForbidden
	}
	return s.storage.PutObject(ctx, m.ObjectKey, r, size, m.Mime)
}

// GetContent opens the media object for streaming. Access control is the caller's job.
func (s *Interactor) GetContent(ctx context.Context, id int64) (io.ReadSeekCloser, ObjectInfo, domain.Media, error) {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, ObjectInfo{}, domain.Media{}, err
	}
	rc, info, err := s.storage.GetObject(ctx, m.ObjectKey)
	if err != nil {
		return nil, ObjectInfo{}, domain.Media{}, err
	}
	if info.ContentType == "" || info.ContentType == "application/octet-stream" {
		info.ContentType = m.Mime // prefer the declared mime
	}
	return rc, info, m, nil
}

func randomKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
