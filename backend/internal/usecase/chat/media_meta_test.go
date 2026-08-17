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

// Признак гифки (media.animated → tweb doc.type === 'gif') доезжает и до
// сообщения, и до live-кадра: без него получатель рисует гифку видео-баблом
// (таймкод + кнопка play вместо бейджа «GIF» и зацикленного автоплея,
// tweb video.ts:120-123,164-171) до перезагрузки истории.
func TestSend_AnimatedGifInMessageAndFrame(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(79)
	s.seedMedia(mediaID, 1)
	s.seedMediaDims(mediaID, MediaDims{
		Mime: "video/mp4", Width: 320, Height: 240, Duration: 3,
		Size: 400000, FileName: "cat.mp4", Animated: true,
	})

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "video", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !msg.MediaAnimated {
		t.Fatalf("hydrated MediaAnimated = false, want true")
	}
	p := messageUpdatePayload(msg)
	if p["media_animated"] != true {
		t.Fatalf("payload media_animated = %v, want true", p["media_animated"])
	}
}

// Обычное видео со звуком: ключа нет вовсе — клиент рисует таймкод и play.
func TestSend_PlainVideoHasNoAnimatedKey(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(80)
	s.seedMedia(mediaID, 1)
	s.seedMediaDims(mediaID, MediaDims{Mime: "video/mp4", Width: 1280, Height: 720, Duration: 61, Size: 9000000})

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "video", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if msg.MediaAnimated {
		t.Fatalf("MediaAnimated = true for a plain video")
	}
	p := messageUpdatePayload(msg)
	if _, ok := p["media_animated"]; ok {
		t.Fatalf("media_animated must be absent: %v", p["media_animated"])
	}
}

// Платное медиа под замком: признак гифки — тоже свойство контента, до оплаты
// его быть не должно (иначе плейсхолдер выдаёт вид медиа).
func TestStripLockedMedia_ClearsAnimated(t *testing.T) {
	m := domain.Message{MediaName: "cat.mp4", MediaAnimated: true}
	stripLockedMedia(&m)
	if m.MediaAnimated {
		t.Fatalf("animated survived lock")
	}
}

// Альбом (медиагруппа): у КАЖДОГО элемента своя мета медиа и в сообщении, и в
// кадре — tweb раскладывает грид по размерам каждого элемента отдельно
// (wrapAlbum → prepareAlbum: items.map(w,h) → Layouter). Общей меты на группу
// нет, поэтому нехватка размеров хотя бы у одного элемента ломает раскладку.
func TestSend_AlbumItemsCarryOwnDims(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	wide, tall := int64(81), int64(82)
	s.seedMedia(wide, 1)
	s.seedMedia(tall, 1)
	s.seedMediaDims(wide, MediaDims{Mime: "image/jpeg", Width: 1600, Height: 900, Size: 500000, Blur: []byte("w")})
	s.seedMediaDims(tall, MediaDims{Mime: "image/jpeg", Width: 900, Height: 1600, Size: 600000, Blur: []byte("t")})

	first, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "photo", MediaID: &wide, GroupedID: "album-1"})
	if err != nil {
		t.Fatalf("Send first: %v", err)
	}
	second, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "photo", MediaID: &tall, GroupedID: "album-1"})
	if err != nil {
		t.Fatalf("Send second: %v", err)
	}

	for _, tc := range []struct {
		name string
		msg  domain.Message
		w, h int
	}{
		{"первый элемент (горизонтальный)", first, 1600, 900},
		{"второй элемент (вертикальный)", second, 900, 1600},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.msg.MediaWidth != tc.w || tc.msg.MediaHeight != tc.h {
				t.Fatalf("hydrated dims = %dx%d, want %dx%d", tc.msg.MediaWidth, tc.msg.MediaHeight, tc.w, tc.h)
			}
			p := messageUpdatePayload(tc.msg)
			if p["media_w"] != tc.w || p["media_h"] != tc.h {
				t.Fatalf("payload dims = %vx%v, want %dx%d", p["media_w"], p["media_h"], tc.w, tc.h)
			}
			if g, _ := p["grouped_id"].(*string); g == nil || *g != "album-1" {
				t.Fatalf("payload grouped_id = %v", p["grouped_id"])
			}
			// stripped-превью тоже на КАЖДОМ элементе: без него элемент альбома
			// открывается пустым прямоугольником до прихода байтов.
			if len(p["media_blur"].([]byte)) == 0 {
				t.Fatalf("payload media_blur missing")
			}
		})
	}
}
