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

// Пики волны голосового (media.waveform) доезжают и до сообщения, и до
// live-кадра. Без ключа в КАДРЕ у живого голосового волны нет до перезагрузки
// истории — ровно тот дефект, что был у send_as; поэтому проверяются обе витрины.
func TestSend_VoiceWaveformInMessageAndFrame(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(83)
	peaks := []byte{0x1f, 0x00, 0x2a, 0xff, 0x07}
	s.seedMedia(mediaID, 1)
	s.seedMediaDims(mediaID, MediaDims{
		Mime: "audio/ogg", Duration: 7, Size: 4200, FileName: "voice.ogg", Waveform: peaks,
	})

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "voice", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if string(msg.MediaWaveform) != string(peaks) {
		t.Fatalf("hydrated MediaWaveform = %v, want %v", msg.MediaWaveform, peaks)
	}
	p := messageUpdatePayload(msg)
	got, ok := p["media_waveform"].([]byte)
	if !ok || string(got) != string(peaks) {
		t.Fatalf("payload media_waveform = %v (ok=%v), want %v", p["media_waveform"], ok, peaks)
	}
}

// Медиа без пиков (фото/файл/старое голосовое): ключа в кадре нет вовсе —
// клиент отличает «пиков нет» от «пустая волна».
func TestSend_NoWaveformNoKey(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(84)
	s.seedMedia(mediaID, 1)
	s.seedMediaDims(mediaID, MediaDims{Mime: "audio/ogg", Duration: 7, Size: 4200, FileName: "voice.ogg"})

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "voice", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	p := messageUpdatePayload(msg)
	if _, ok := p["media_waveform"]; ok {
		t.Fatalf("media_waveform must be absent: %v", p["media_waveform"])
	}
}

// Платное медиа под замком: пики — тоже мета контента (по ним видно длину и
// «форму» записи), до оплаты их быть не должно.
func TestStripLockedMedia_ClearsWaveform(t *testing.T) {
	m := domain.Message{MediaName: "voice.ogg", MediaWaveform: []byte{1, 2, 3}}
	stripLockedMedia(&m)
	if m.MediaWaveform != nil {
		t.Fatalf("waveform survived lock: %v", m.MediaWaveform)
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

// Спойлер (telegram messageMedia.pFlags.spoiler) доезжает и до сообщения, и до
// live-кадра: без ключа в КАДРЕ живое медиа у получателя показывается открытым
// до перезагрузки истории — то есть раскрывает ровно то, что отправитель просил
// скрыть (тот же дефект, что был у send_as; поэтому проверяются обе витрины).
func TestSend_SpoilerInMessageAndFrame(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(81)
	s.seedMedia(mediaID, 1)
	s.seedMediaDims(mediaID, MediaDims{
		Mime: "image/jpeg", Width: 1280, Height: 960, Size: 250000, FileName: "secret.jpg",
	})

	msg, err := in.Send(ctx, SendInput{
		ChatID: chatID, SenderID: 1, Type: "photo", MediaID: &mediaID, MediaSpoiler: true,
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !msg.MediaSpoiler {
		t.Fatalf("MediaSpoiler = false, want true")
	}
	p := messageUpdatePayload(msg)
	if p["media_spoiler"] != true {
		t.Fatalf("payload media_spoiler = %v, want true", p["media_spoiler"])
	}
}

// Обычное медиа без спойлера: ключа в кадре нет вовсе — клиент отличает
// «спойлера нет» от «спойлер снят», как у остальных флагов витрины.
func TestSend_NoSpoilerNoKey(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	mediaID := int64(82)
	s.seedMedia(mediaID, 1)
	s.seedMediaDims(mediaID, MediaDims{Mime: "image/jpeg", Width: 800, Height: 600, Size: 90000})

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Type: "photo", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if msg.MediaSpoiler {
		t.Fatalf("MediaSpoiler = true without the flag")
	}
	p := messageUpdatePayload(msg)
	if _, ok := p["media_spoiler"]; ok {
		t.Fatalf("media_spoiler must be absent: %v", p["media_spoiler"])
	}
}

// Спойлер — свойство ВЛОЖЕНИЯ: у текстового сообщения без media_id флаг с входа
// игнорируется (как гейтится и цена платного медиа), иначе клиент получил бы
// заслонку поверх пустоты.
func TestSend_SpoilerIgnoredWithoutMedia(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	msg, err := in.Send(ctx, SendInput{
		ChatID: chatID, SenderID: 1, Type: "text", Text: "hi", MediaSpoiler: true,
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if msg.MediaSpoiler {
		t.Fatalf("MediaSpoiler = true for a message without media")
	}
}

// Платное медиа под замком: спойлер тоже гасится — заблокированное медиа уже
// скрыто плейсхолдером с ценой, вторая заслонка похоронила бы кнопку
// разблокировки (флаг остаётся в БД и вернётся после оплаты).
func TestStripLockedMedia_ClearsSpoiler(t *testing.T) {
	m := domain.Message{MediaName: "secret.jpg", MediaSpoiler: true}
	stripLockedMedia(&m)
	if m.MediaSpoiler {
		t.Fatalf("spoiler survived lock")
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
