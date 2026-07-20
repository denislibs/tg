// Package botmedia adapts the media usecase to the chat usecase's BotMediaStore
// port: it lets a bot persist a media object it owns (sendPhoto/Document/Video)
// and returns the media id to attach to a message.
package botmedia

import (
	"bytes"
	"context"

	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// Store wraps the media usecase.
type Store struct {
	media *usecasemedia.Interactor
}

func New(media *usecasemedia.Interactor) *Store { return &Store{media: media} }

// Store records a bot-owned media object and streams the bytes into storage,
// returning the new media id. Dims/thumbnail are derived in the background by
// the media processor (as for normal uploads).
func (s *Store) Store(ctx context.Context, ownerID int64, mime, fileName string, data []byte) (int64, error) {
	m, _, err := s.media.CreateUpload(ctx, usecasemedia.UploadInput{
		OwnerID:  ownerID,
		Mime:     mime,
		Size:     int64(len(data)),
		FileName: fileName,
	})
	if err != nil {
		return 0, err
	}
	if err := s.media.PutContent(ctx, m.ID, ownerID, bytes.NewReader(data), int64(len(data))); err != nil {
		return 0, err
	}
	return m.ID, nil
}
