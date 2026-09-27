package chat

import (
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Фото служебного действия собирается ФОТОГРАФИЕЙ, хотя тип строки —
// 'service'. Иначе вложение выходит документом, MediaPhoto его не узнаёт, и
// action.photo уезжает null — в живом кадре и в истории одинаково, так что
// пилюле «обновил(а) фото группы» рисовать нечего.
func TestBuildMedia_ServicePhotoActionIsPhoto(t *testing.T) {
	mediaID := int64(14290)
	m := domain.Message{
		Seq: 36, Type: "service", MediaID: &mediaID,
		Action: domain.NewMessageActionChatEditPhoto(nil),
	}
	m.Media = buildMedia(m, domain.MediaSource{Width: 640, Height: 640, Mime: "image/jpeg", Blur: []byte{1, 2, 3}, Size: 42104})
	photo := domain.MediaPhoto(m.Media)
	if photo == nil || photo.ID != mediaID {
		t.Fatalf("вложение = %#v; want фото %d", m.Media, mediaID)
	}
	wire, ok := m.ToWire(domain.MessageContext{Peer: domain.NewPeerChannel(6)}).(domain.MessageService)
	if !ok {
		t.Fatal("служебное сообщение ушло не messageService")
	}
	action, ok := wire.Action.(domain.MessageActionChatEditPhoto)
	if !ok || action.Photo == nil || action.Photo.ID != mediaID {
		t.Fatalf("action = %#v; want messageActionChatEditPhoto.photo %d", wire.Action, mediaID)
	}
	if len(domain.MediaStrippedThumb(m.Media)) == 0 {
		t.Error("stripped-превью фото действия потеряно")
	}
}
