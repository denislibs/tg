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
	// The chunked/resumable path (assembled server-side) lifts the cap well above
	// the single-PUT limit; the legacy PutContent path stays capped at maxSize by
	// its own MaxBytesReader.
	if in.Size > maxChunkedSize {
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

// SavePart stores one chunk of a resumable upload as a MinIO multipart part.
// Only the owner may upload. The multipart upload is started lazily on the first
// part (concurrent first parts converge via SetUploadID). Re-uploading a part is
// idempotent. partIndex is 1-based (maps directly to the S3 part number).
func (s *Interactor) SavePart(ctx context.Context, id, ownerID int64, partIndex, total int, r io.Reader, size int64) error {
	if partIndex < 1 || partIndex > maxParts {
		return ErrBadPart
	}
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if m.OwnerID != ownerID {
		return ErrForbidden
	}
	uploadID := m.UploadID
	if uploadID == "" {
		newID, err := s.storage.StartMultipart(ctx, m.ObjectKey, m.Mime)
		if err != nil {
			return err
		}
		uploadID, err = s.repo.SetUploadID(ctx, id, newID)
		if err != nil {
			return err
		}
		if uploadID != newID {
			// Lost the race to another concurrent first part — abort our stray
			// multipart and use the winning one.
			_ = s.storage.AbortMultipart(ctx, m.ObjectKey, newID)
		}
	}
	if total > 0 {
		_ = s.repo.SetUploadTotal(ctx, id, total)
	}
	etag, err := s.storage.PutPart(ctx, m.ObjectKey, uploadID, partIndex, r, size)
	if err != nil {
		return err
	}
	return s.repo.SavePart(ctx, id, partIndex, etag, size)
}

// ReceivedParts reports which part indices are already stored (for resume) plus
// the declared total. Only the owner may query.
func (s *Interactor) ReceivedParts(ctx context.Context, id, ownerID int64) ([]int, int, error) {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	if m.OwnerID != ownerID {
		return nil, 0, ErrForbidden
	}
	idx, err := s.repo.ReceivedParts(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	return idx, m.UploadTotal, nil
}

// FinalizeUpload completes the multipart upload (assembling the parts into the
// final object), records the actual metadata, and kicks off background
// processing — mirroring PutContent's tail. Only the owner may finalize.
func (s *Interactor) FinalizeUpload(ctx context.Context, id, ownerID int64, in FinalizeInput) error {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if m.OwnerID != ownerID {
		return ErrForbidden
	}
	if m.UploadID == "" {
		return ErrNoUpload
	}
	parts, err := s.repo.PartsForComplete(ctx, id)
	if err != nil {
		return err
	}
	if len(parts) == 0 {
		return ErrNoUpload
	}
	if in.Total > 0 && len(parts) != in.Total {
		return ErrMissingParts
	}
	// Parts must be a contiguous 1..N run — a gap means a chunk never arrived.
	for i, p := range parts {
		if p.PartNumber != i+1 {
			return ErrMissingParts
		}
	}
	if err := s.storage.CompleteMultipart(ctx, m.ObjectKey, m.UploadID, parts); err != nil {
		return err
	}
	if err := s.repo.UpdateFinalized(ctx, id, in.Size, in.Width, in.Height, in.Duration, in.FileName, in.Mime); err != nil {
		return err
	}
	_ = s.repo.ClearUpload(ctx, id)
	if s.processor != nil {
		m.Size, m.Width, m.Height, m.Duration = in.Size, in.Width, in.Height, in.Duration
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
