package media

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Interactor implements the media usecase over a MediaRepo and ObjectStorage.
type Interactor struct {
	repo      MediaRepo
	storage   ObjectStorage
	processor MediaProcessor // optional; nil disables server-side processing
}

func New(repo MediaRepo, storage ObjectStorage, processor MediaProcessor) *Interactor {
	return &Interactor{repo: repo, storage: storage, processor: processor}
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
		Duration: in.Duration, BlurPreview: in.BlurPreview, FileName: in.FileName,
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
	if err := s.storage.PutObject(ctx, m.ObjectKey, r, size, m.Mime); err != nil {
		return err
	}
	// Derive dims/duration + a thumbnail in the background so the upload returns
	// immediately; the row is updated when processing finishes.
	if s.processor != nil {
		go s.process(m)
	}
	return nil
}

// process re-reads the stored original, probes it, generates a thumbnail/poster,
// stores the thumb, and records the results. Runs detached from the request.
func (s *Interactor) process(m domain.Media) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	rc, _, err := s.storage.GetObject(ctx, m.ObjectKey)
	if err != nil {
		log.Printf("media: process %d: get original: %v", m.ID, err)
		return
	}
	defer rc.Close()
	res, err := s.processor.Process(ctx, rc, m.Mime)
	if err != nil {
		log.Printf("media: process %d: %v", m.ID, err)
		return
	}
	var thumbKey string
	if len(res.Thumb) > 0 {
		thumbKey = m.ObjectKey + ".thumb.jpg"
		if err := s.storage.PutObject(ctx, thumbKey, bytes.NewReader(res.Thumb), int64(len(res.Thumb)), "image/jpeg"); err != nil {
			log.Printf("media: process %d: put thumb: %v", m.ID, err)
			thumbKey = ""
		}
	}
	if err := s.repo.UpdateProcessed(ctx, m.ID, res.Width, res.Height, res.Duration, thumbKey); err != nil {
		log.Printf("media: process %d: update: %v", m.ID, err)
	}
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

// GetThumbContent opens the generated thumbnail/poster for streaming. Returns
// domain.ErrNotFound when the media has no thumbnail. Access control is the caller's job.
func (s *Interactor) GetThumbContent(ctx context.Context, id int64) (io.ReadSeekCloser, ObjectInfo, error) {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	if m.ThumbKey == "" {
		return nil, ObjectInfo{}, domain.ErrNotFound
	}
	rc, info, err := s.storage.GetObject(ctx, m.ThumbKey)
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	if info.ContentType == "" || info.ContentType == "application/octet-stream" {
		info.ContentType = "image/jpeg"
	}
	return rc, info, nil
}

func randomKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
