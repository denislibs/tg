package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Теги трека из read-модели медиа доезжают до сообщения и до live-кадра
// (media_title / media_performer) — клиент подписывает музыкальный бабл ими, а не
// размером файла (tweb audio.ts).
func TestSend_AudioTagsInMessageAndFrame(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(77)
	s.seedMedia(mediaID, 1)
	s.seedMediaDims(mediaID, MediaDims{
		Mime: "audio/mpeg", Duration: 139, Size: 3300000,
		FileName: "track.mp3", Title: "Track One", Performer: "denis1488",
	})

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "audio", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if msg.MediaTitle != "Track One" || msg.MediaPerformer != "denis1488" {
		t.Fatalf("hydrated tags = %q / %q", msg.MediaTitle, msg.MediaPerformer)
	}
	p := messageUpdatePayload(msg)
	if p["media_title"] != "Track One" {
		t.Fatalf("payload media_title = %v", p["media_title"])
	}
	if p["media_performer"] != "denis1488" {
		t.Fatalf("payload media_performer = %v", p["media_performer"])
	}
}

// Файл без тегов: ключей в кадре нет вовсе (клиент откатывается на размер файла).
func TestSend_NoAudioTagsNoKeys(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(78)
	s.seedMedia(mediaID, 1)
	s.seedMediaDims(mediaID, MediaDims{Mime: "audio/mpeg", Duration: 12, Size: 100500, FileName: "voice.ogg"})

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "audio", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	p := messageUpdatePayload(msg)
	if _, ok := p["media_title"]; ok {
		t.Fatalf("media_title must be absent: %v", p["media_title"])
	}
	if _, ok := p["media_performer"]; ok {
		t.Fatalf("media_performer must be absent: %v", p["media_performer"])
	}
	if p["media_size"] != int64(100500) {
		t.Fatalf("media_size = %v", p["media_size"])
	}
}

// Платное медиа под замком: теги трека вычищаются вместе с остальной метой
// контента — до оплаты получатель не должен видеть исполнителя/название.
func TestStripLockedMedia_ClearsAudioTags(t *testing.T) {
	m := domain.Message{
		MediaName: "track.mp3", MediaDuration: 139,
		MediaTitle: "Track One", MediaPerformer: "denis1488",
	}
	stripLockedMedia(&m)
	if m.MediaTitle != "" || m.MediaPerformer != "" {
		t.Fatalf("tags survived lock: %q / %q", m.MediaTitle, m.MediaPerformer)
	}
}
