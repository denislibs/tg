package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// sendWithMedia отправляет сообщение с посеянным медиа и возвращает его вместе с
// вложением live-кадра. Обе витрины проверяются одним вызовом намеренно: у
// расхождения между историей и кадром своя история дефектов (send_as), поэтому
// каждый тип медиа сверяется в обеих.
func sendWithMedia(t *testing.T, kind string, mediaID int64, dims MediaDims, in SendInput) (domain.Message, *domain.MessageMedia) {
	t.Helper()
	s := newStore()
	i := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	ctx := context.Background()

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	s.seedMedia(mediaID, 1)
	s.seedMediaDims(mediaID, dims)

	in.ChatID, in.SenderID, in.Type = chatID, 1, kind
	if in.MediaID == nil {
		in.MediaID = &mediaID
	}
	msg, err := i.Send(ctx, in)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	p := i.messageUpdatePayload(ctx, msg)
	frameMedia, _ := p["media"].(*domain.MessageMedia)
	if frameMedia != msg.Media {
		t.Fatalf("live-кадр отдаёт не то же вложение, что сообщение: %#v vs %#v", frameMedia, msg.Media)
	}
	return msg, frameMedia
}

// Теги трека из read-модели доезжают до сообщения и до live-кадра внутри
// documentAttributeAudio — клиент подписывает музыкальный бабл ими, а не
// размером файла (tweb audio.ts).
func TestSend_AudioTagsInMessageAndFrame(t *testing.T) {
	_, md := sendWithMedia(t, "audio", 77, MediaDims{
		Mime: "audio/mpeg", Duration: 139, Size: 3300000,
		FileName: "track.mp3", Title: "Track One", Performer: "denis1488",
	}, SendInput{})
	a, ok := md.AudioAttr()
	if !ok || a.Title != "Track One" || a.Performer != "denis1488" || a.Duration != 139 {
		t.Fatalf("documentAttributeAudio = %#v", a)
	}
}

// Файл без тегов: атрибут есть (длительность нужна), но тегов в нём нет —
// клиент откатывается на размер файла.
func TestSend_NoAudioTagsNoKeys(t *testing.T) {
	_, md := sendWithMedia(t, "audio", 78, MediaDims{
		Mime: "audio/mpeg", Duration: 12, Size: 100500, FileName: "voice.ogg",
	}, SendInput{})
	a, ok := md.AudioAttr()
	if !ok || a.Title != "" || a.Performer != "" {
		t.Fatalf("теги у файла без тегов: %#v", a)
	}
	if md.Document.Size != 100500 {
		t.Fatalf("document.size = %d", md.Document.Size)
	}
}

// Пики волны голосового доезжают внутри documentAttributeAudio вместе с
// pFlags.voice. Без них у ЖИВОГО голосового волны нет до перезагрузки истории.
func TestSend_VoiceWaveformInMessageAndFrame(t *testing.T) {
	peaks := []byte{0x1f, 0x00, 0x2a, 0xff, 0x07}
	_, md := sendWithMedia(t, "voice", 83, MediaDims{
		Mime: "audio/ogg", Duration: 7, Size: 4200, FileName: "voice.ogg", Waveform: peaks,
	}, SendInput{})
	a, ok := md.AudioAttr()
	if !ok || !a.PFlags["voice"] || string(a.Waveform) != string(peaks) {
		t.Fatalf("documentAttributeAudio = %#v", a)
	}
}

// Медиа без пиков: поля waveform в атрибуте нет вовсе — клиент отличает
// «пиков нет» от «пустая волна».
func TestSend_NoWaveformNoKey(t *testing.T) {
	_, md := sendWithMedia(t, "voice", 84, MediaDims{
		Mime: "audio/ogg", Duration: 7, Size: 4200, FileName: "voice.ogg",
	}, SendInput{})
	if a, ok := md.AudioAttr(); !ok || a.Waveform != nil {
		t.Fatalf("waveform без пиков = %#v", a)
	}
}

// Гифка объявляется documentAttributeAnimated — тем же атрибутом, из которого
// оригинал выводит doc.type === 'gif' (бейдж «GIF» и зацикленный автоплей
// вместо таймкода с кнопкой play, tweb video.ts:120-123,164-171).
func TestSend_AnimatedGifInMessageAndFrame(t *testing.T) {
	_, md := sendWithMedia(t, "video", 79, MediaDims{
		Mime: "video/mp4", Width: 320, Height: 240, Duration: 3,
		Size: 400000, FileName: "cat.mp4", Animated: true,
	}, SendInput{})
	if !md.HasAttribute(domain.AttrAnimated) {
		t.Fatalf("гифка без documentAttributeAnimated: %#v", md.Document.Attributes)
	}
}

// Обычное видео со звуком: атрибута animated нет — клиент рисует таймкод и play.
func TestSend_PlainVideoHasNoAnimatedKey(t *testing.T) {
	_, md := sendWithMedia(t, "video", 80, MediaDims{
		Mime: "video/mp4", Width: 1280, Height: 720, Duration: 61, Size: 9000000,
	}, SendInput{})
	if md.HasAttribute(domain.AttrAnimated) {
		t.Fatalf("documentAttributeAnimated у обычного видео")
	}
	if a, ok := md.VideoAttr(); !ok || a.W != 1280 || a.H != 720 || a.Duration != 61 {
		t.Fatalf("documentAttributeVideo = %#v", a)
	}
}

// Векторный контур стикера (photoPathSize) доезжает до САМОГО СООБЩЕНИЯ — и в
// историю, и в live-кадр. Раньше он был только в ручках стикеров: в медиа
// сообщения ему просто не было места, и клиент рисовал силуэт лишь там, где
// стикер приезжал из набора.
func TestSend_StickerPathThumbReachesMessage(t *testing.T) {
	outline := []byte{'M', '1', '2', '3'}
	_, md := sendWithMedia(t, "sticker", 85, MediaDims{
		Mime: "image/webp", Width: 512, Height: 512, Size: 30000, PathThumb: outline,
	}, SendInput{})
	if !md.HasAttribute(domain.AttrSticker) {
		t.Fatalf("стикер без documentAttributeSticker: %#v", md.Document.Attributes)
	}
	if string(md.PathThumb()) != string(outline) {
		t.Fatalf("контур не доехал: thumbs = %#v", md.Document.Thumbs)
	}
}

// Спойлер живёт в media.pFlags и доезжает до обеих витрин: без него живое медиа
// у получателя показывается открытым до перезагрузки истории — то есть
// раскрывает ровно то, что отправитель просил скрыть.
func TestSend_SpoilerInMessageAndFrame(t *testing.T) {
	msg, md := sendWithMedia(t, "photo", 81, MediaDims{
		Mime: "image/jpeg", Width: 1280, Height: 960, Size: 250000, FileName: "secret.jpg",
	}, SendInput{MediaSpoiler: true})
	if !msg.MediaSpoiler {
		t.Fatalf("MediaSpoiler = false, want true")
	}
	if !md.PFlags["spoiler"] {
		t.Fatalf("media.pFlags = %#v", md.PFlags)
	}
}

// Обычное медиа без спойлера: флага нет вовсе.
func TestSend_NoSpoilerNoKey(t *testing.T) {
	msg, md := sendWithMedia(t, "photo", 82, MediaDims{
		Mime: "image/jpeg", Width: 800, Height: 600, Size: 90000,
	}, SendInput{})
	if msg.MediaSpoiler {
		t.Fatalf("MediaSpoiler = true without the flag")
	}
	if md.PFlags["spoiler"] {
		t.Fatalf("media.pFlags = %#v", md.PFlags)
	}
}

// Спойлер — свойство ВЛОЖЕНИЯ: у текстового сообщения без media_id флаг с входа
// игнорируется, иначе клиент получил бы заслонку поверх пустоты.
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
	if msg.Media != nil {
		t.Fatalf("вложение у текстового сообщения: %#v", msg.Media)
	}
}

// Платное медиа под замком: от вложения остаётся только псевдо-фото без id —
// stripped-плейсхолдер и размеры кадра. Ни mime, ни имени файла, ни
// длительности, ни волны, ни тегов трека, ни признака гифки, ни заслонки: всё
// это мета контента, по которой до оплаты видно, ЧТО именно куплено.
func TestStripLockedMedia_LeavesOnlyPlaceholder(t *testing.T) {
	mid := int64(9)
	m := domain.Message{
		Type: "video", MediaID: &mid, MediaSpoiler: true,
		Media: domain.BuildMessageMedia(domain.MediaSource{
			Kind: "video", MediaID: mid, Width: 1280, Height: 720, Mime: "video/mp4",
			Duration: 61, Size: 9e6, FileName: "cat.mp4", Animated: true,
			Title: "Track One", Performer: "denis1488", Waveform: []byte{1, 2, 3},
			Blur: []byte("stripped"), HasThumb: true, Spoiler: true,
		}),
	}
	stripLockedMedia(&m)

	if m.MediaID != nil {
		t.Fatalf("media_id survived lock: %v", *m.MediaID)
	}
	if m.MediaSpoiler {
		t.Fatalf("spoiler survived lock")
	}
	if m.Media == nil || m.Media.Underscore != domain.MessageMediaPhotoTag || m.Media.Document != nil {
		t.Fatalf("под замком должно остаться псевдо-фото: %#v", m.Media)
	}
	if m.Media.Photo.ID != 0 {
		t.Fatalf("photo.id = %d, скачивать нечего — должен быть 0", m.Media.Photo.ID)
	}
	if string(m.Media.StrippedThumb()) != "stripped" {
		t.Fatalf("stripped-плейсхолдер потерян: %#v", m.Media.Photo.Sizes)
	}
	if w, h := m.Media.Dimensions(); w != 1280 || h != 720 {
		t.Fatalf("размеры кадра = %dx%d, want 1280x720", w, h)
	}
	// Ступени, по которым можно получить байты, и любая мета контента — ушли.
	for _, sz := range m.Media.Photo.Sizes {
		if v, ok := sz.(domain.PhotoSizeReal); ok && v.Type == domain.SizeTypeThumb {
			t.Fatalf("серверное превью осталось под замком: %#v", v)
		}
	}
	if m.Media.HasAttribute(domain.AttrAudio) || m.Media.HasAttribute(domain.AttrAnimated) ||
		m.Media.FileName() != "" {
		t.Fatalf("атрибуты документа пережили замок: %#v", m.Media)
	}
}

// Альбом (медиагруппа): у КАЖДОГО элемента своя лестница размеров и в сообщении,
// и в кадре — tweb раскладывает грид по размерам каждого элемента отдельно
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
			if w, h := tc.msg.Media.Dimensions(); w != tc.w || h != tc.h {
				t.Fatalf("hydrated dims = %dx%d, want %dx%d", w, h, tc.w, tc.h)
			}
			p := in.messageUpdatePayload(ctx, tc.msg)
			md, _ := p["media"].(*domain.MessageMedia)
			if md == nil {
				t.Fatalf("в кадре нет вложения: %#v", p["media"])
			}
			if w, h := md.Dimensions(); w != tc.w || h != tc.h {
				t.Fatalf("payload dims = %dx%d, want %dx%d", w, h, tc.w, tc.h)
			}
			if g, _ := p["grouped_id"].(*string); g == nil || *g != "album-1" {
				t.Fatalf("payload grouped_id = %v", p["grouped_id"])
			}
			// stripped-превью тоже на КАЖДОМ элементе: без него элемент альбома
			// открывается пустым прямоугольником до прихода байтов.
			if len(md.StrippedThumb()) == 0 {
				t.Fatalf("payload stripped-ступень отсутствует: %#v", md.Photo.Sizes)
			}
		})
	}
}
