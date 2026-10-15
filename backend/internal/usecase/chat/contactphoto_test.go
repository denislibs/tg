package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Предложение фото — сервисное сообщение с медиа предложившего. Принятия на
// сервере нет: в tweb «Установить фото» скачивает файл и ставит его СВОЕЙ
// загрузкой через photos.uploadProfilePhoto (bubbles.ts:8236-8246).
func TestSuggestProfilePhoto(t *testing.T) {
	ctx := context.Background()
	in, s := newInteractor()

	const suggester, recipient = int64(1), int64(2)
	s.seedMedia(99, suggester) // the suggested photo belongs to the suggester
	msg, err := in.SuggestProfilePhoto(ctx, suggester, recipient, 99)
	if err != nil {
		t.Fatalf("SuggestProfilePhoto: %v", err)
	}
	if msg.Type != "service" || msg.MediaID == nil || *msg.MediaID != 99 {
		t.Fatalf("suggest message: type=%q media=%v", msg.Type, msg.MediaID)
	}

	// Себе предлагать нечего.
	if _, err := in.SuggestProfilePhoto(ctx, suggester, suggester, 99); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("suggest to self = %v; want ErrInvalid", err)
	}
	// Чужой файл предложить нельзя (владельца проверяет Send).
	s.seedMedia(100, recipient)
	if _, err := in.SuggestProfilePhoto(ctx, suggester, recipient, 100); err == nil {
		t.Fatal("suggest of a foreign file succeeded")
	}
}
