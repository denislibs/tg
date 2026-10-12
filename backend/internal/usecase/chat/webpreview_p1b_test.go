package chat

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// webPageFrameSizes — ступени фото карточки в последнем web_page_update
// получателю userID.
func webPageFrameSizes(t *testing.T, pub *fakePublisher, userID int64) []map[string]any {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	var sizes []map[string]any
	for _, f := range pub.frames {
		var env struct {
			T string `json:"t"`
			D struct {
				Media struct {
					WebPage struct {
						Photo struct {
							Sizes []map[string]any `json:"sizes"`
						} `json:"photo"`
					} `json:"webpage"`
				} `json:"media"`
			} `json:"d"`
		}
		if f.userID == userID && json.Unmarshal(f.frame, &env) == nil && env.T == "web_page_update" {
			sizes = env.D.Media.WebPage.Photo.Sizes
		}
	}
	return sizes
}

// Баг C2 №1: живой кадр карточки несёт размер фото сразу — до обработки
// медиа (её размер приходит в строку media позже), иначе tweb рисует
// картинку квадратом до перезагрузки (bubbles.ts:9592-9593).
func TestWebPageFrame_PhotoHasSizeBeforeProcessing(t *testing.T) {
	e := newPreviewEnv(t)
	e.in.SetBotHTTP(&fakeOutHTTP{data: pngOf(t, 800, 400), mime: "image/png"})
	e.in.SetBotMedia(&fakeMediaStore{})
	e.prev.imageURL = "https://cdn.example/og.png"
	ctx := context.Background()
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "без ссылки"})
	if _, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "https://a.example/x", nil); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	e.in.bg.Wait()
	sizes := webPageFrameSizes(t, e.pub, 2)
	full := false
	for _, sz := range sizes {
		if sz["w"] == float64(800) && sz["h"] == float64(400) {
			full = true
		}
	}
	if !full {
		t.Fatalf("ступени фото в кадре карточки = %v; ждали размер 800×400", sizes)
	}
	// История до обработки медиа (в строке media размера ещё нет) — тот же размер.
	e.s.seedMediaDims(storedMsg(t, e.s, msg.ID).WebPage.PhotoID, domain.MediaSource{Mime: "image/png"})
	ms := []domain.Message{storedMsg(t, e.s, msg.ID)}
	if err := e.in.hydrateMedia(ctx, ms); err != nil {
		t.Fatal(err)
	}
	if wp := ms[0].WebPage; wp.PhotoW != 800 || wp.PhotoH != 400 {
		t.Fatalf("история до обработки: %d×%d", wp.PhotoW, wp.PhotoH)
	}
}

// Баг C2 №2: сборка карточки берёт страницу, которую плашка уже загрузила
// (кэш getWebPage) — без второго похода на сайт, и сбой повторной загрузки
// не оставляет отложенное (и сообщение) без карточки, показанной на плашке.
func TestScheduledPreview_UsesPlaqueCard(t *testing.T) {
	in, _, fs, prev, cid := scheduledPreviewEnv(t)
	ctx := context.Background()
	const u = "https://a.example/x"
	if wp := in.GetWebPage(ctx, u); wp == nil {
		t.Fatal("плашка без карточки")
	}
	prev.mu.Lock()
	prev.fail = 5 // сайт больше не отвечает
	prev.mu.Unlock()
	media := &domain.InputMediaWebPage{Underscore: domain.InputMediaWebPageTag, URL: u, PFlags: map[string]bool{"optional": true}}
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "смотри " + u, ScheduleDate: future(),
		WebPage: domain.WebPageInput{InvertMedia: true, Media: media}})
	if err != nil {
		t.Fatal(err)
	}
	in.bg.Wait()
	if wp := scheduledRow(t, fs, sm.Seq).WebPage; wp == nil || wp.URL != u {
		t.Fatalf("отложенное без карточки плашки: %+v", wp)
	}
	if n := len(prev.calls()); n != 1 {
		t.Fatalf("загрузок страницы %d; ждали 1 (только плашка)", n)
	}
}

// Сбой загрузки страницы повторяется один раз.
func TestBuildWebPreview_RetriesPageOnce(t *testing.T) {
	old := pageRetryDelay
	pageRetryDelay = time.Millisecond
	defer func() { pageRetryDelay = old }()
	e := newPreviewEnv(t)
	e.prev.fail = 1
	msg, _ := e.in.Send(context.Background(), SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x"})
	e.in.bg.Wait()
	if storedMsg(t, e.s, msg.ID).WebPage == nil {
		t.Fatal("карточки нет после одного сбоя загрузки")
	}
	if n := len(e.prev.calls()); n != 2 {
		t.Fatalf("загрузок %d; ждали 2", n)
	}
}

// Кэш плашки: адрес набранный (кириллица) и адрес из webPage.url (в разборе
// url.Parse — процентная кодировка) — один ключ; из кэша наружу не уходит
// адрес чужой картинки, а сборке сообщения не достаётся has_large_media
// плашки (его ставит только сохранённая картинка).
func TestWebPageCache_KeyAndLeaks(t *testing.T) {
	e := newPreviewEnv(t)
	e.prev.large, e.prev.imageURL = true, "https://cdn.example/og.png"
	ctx := context.Background()
	raw := "https://a.example/путь"
	if wp := e.in.GetWebPage(ctx, raw); wp == nil || wp.ImageURL != "" {
		t.Fatalf("плашка = %+v", wp)
	}
	if wp := e.in.GetWebPage(ctx, raw); wp == nil || wp.ImageURL != "" {
		t.Fatalf("плашка из кэша = %+v", wp)
	}
	page := e.in.webPages.page(ctx, "https://a.example/%D0%BF%D1%83%D1%82%D1%8C")
	if page == nil || page.ImageURL == "" || page.HasLargeMedia {
		t.Fatalf("страница для сборки = %+v; ждали адрес картинки и без has_large_media", page)
	}
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок страницы %d; ждали 1", n)
	}
}

// Плашка сбой не повторяет: tweb перезапросит при следующей ссылке.
func TestGetWebPage_NoRetry(t *testing.T) {
	e := newPreviewEnv(t)
	e.prev.fail = 1
	if wp := e.in.GetWebPage(context.Background(), "https://a.example/x"); wp != nil {
		t.Fatalf("карточка = %+v", wp)
	}
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок %d; ждали 1", n)
	}
}

// Отказ по существу (не HTML, нет заголовка, 4xx) не повторяется: повтор
// его не исправит, а сайту — лишний запрос.
func TestBuildWebPreview_PermanentFailureNotRetried(t *testing.T) {
	old := pageRetryDelay
	pageRetryDelay = time.Millisecond
	defer func() { pageRetryDelay = old }()
	e := newPreviewEnv(t)
	e.prev.permanent = true
	e.in.Send(context.Background(), SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/file.pdf"})
	e.in.bg.Wait()
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок %d; ждали 1", n)
	}
}

// Плашка того же адреса ещё грузится — сборка карточки ждёт её, а не грузит
// медленный сайт вторым запросом. Страница отпускается только после того, как
// сборка встала в ожидание (шов onWait).
func TestBuildWebPreview_WaitsForPlaqueLoad(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	const u = "https://slow.example/x"
	waiting := make(chan struct{}, 1)
	e.in.webPages.onWait = func() { waiting <- struct{}{} }
	release := e.prev.hold(u)
	plaque := make(chan *domain.WebPagePreview)
	go func() { plaque <- e.in.GetWebPage(ctx, u) }()
	waitFor(t, func() bool { return len(e.prev.calls()) == 1 })
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: u})
	<-waiting
	close(release)
	if wp := <-plaque; wp == nil {
		t.Fatal("плашка без карточки")
	}
	e.in.bg.Wait()
	if storedMsg(t, e.s, msg.ID).WebPage == nil {
		t.Fatal("сообщение без карточки")
	}
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок %d; ждали 1 (сборка дождалась плашки)", n)
	}
}

// slowHeadHTTP — картинка, заголовок которой (FetchPrefix плашки) отдаётся
// только по release; целиком (FetchURL сборки) — сразу.
type slowHeadHTTP struct {
	fakeOutHTTP
	release chan struct{}
}

func (h *slowHeadHTTP) FetchPrefix(ctx context.Context, url string, maxBytes int64) ([]byte, string, error) {
	select {
	case <-h.release:
	case <-ctx.Done():
		return nil, "", ctx.Err()
	}
	return h.fakeOutHTTP.FetchPrefix(ctx, url, maxBytes)
}

// Ревью «Ревьюер» 1: «вставил и Enter» — ожидание плашки кончается, как только
// страница загружена; медленный заголовок картинки плашки (has_large_media)
// сборку не держит и её бюджет не съедает.
func TestBuildWebPreview_DoesNotWaitPlaqueImageHead(t *testing.T) {
	e := newPreviewEnv(t)
	head := &slowHeadHTTP{fakeOutHTTP: fakeOutHTTP{data: pngOf(t, 800, 400), mime: "image/png"}, release: make(chan struct{})}
	e.in.SetBotHTTP(head)
	e.in.SetBotMedia(&fakeMediaStore{})
	e.prev.imageURL = "https://cdn.example/og.png"
	ctx := context.Background()
	const u = "https://a.example/x"
	plaque := make(chan *domain.WebPagePreview)
	go func() { plaque <- e.in.GetWebPage(ctx, u) }()
	waitFor(t, func() bool { _, ok := e.in.webPages.get(u); return ok })
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: u})
	// Сборка завершается, пока заголовок картинки плашки ещё висит.
	waitFor(t, func() bool { return storedMsg(t, e.s, msg.ID).WebPage != nil })
	if wp := storedMsg(t, e.s, msg.ID).WebPage; wp.PhotoID == 0 || !wp.HasLargeMedia {
		t.Fatalf("карточка сообщения = %+v", wp)
	}
	close(head.release)
	if wp := <-plaque; wp == nil || !wp.HasLargeMedia {
		t.Fatalf("плашка = %+v", wp)
	}
	e.in.bg.Wait()
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок страницы %d; ждали 1", n)
	}
}

// Временный сбой плашки «карточки нет» не кэширует: следующий запрос того же
// адреса снова идёт на сайт.
func TestGetWebPage_TransientNotCached(t *testing.T) {
	e := newPreviewEnv(t)
	e.prev.fail = 1
	ctx := context.Background()
	if e.in.GetWebPage(ctx, "https://a.example/x") != nil {
		t.Fatal("карточка при сбое")
	}
	if e.in.GetWebPage(ctx, "https://a.example/x") == nil {
		t.Fatal("временный сбой закэширован")
	}
}

// Ссылка с парными скобками (Википедия) — целиком, непарная скобка и
// пунктуация — не часть ссылки.
func TestFirstURL_Parens(t *testing.T) {
	for in, want := range map[string]string{
		"см. https://ru.wikipedia.org/wiki/X_(y)": "https://ru.wikipedia.org/wiki/X_(y)",
		"(см. https://a.example/c)":               "https://a.example/c",
		"смотри https://a.example/c.":             "https://a.example/c",
		"«https://a.example/c»":                   "https://a.example/c",
		"https://ru.wikipedia.org/wiki/X_(y)).":   "https://ru.wikipedia.org/wiki/X_(y)",
	} {
		if got := firstURL(in, nil); got != want {
			t.Errorf("%q → %q; want %q", in, got, want)
		}
	}
}

// photoSizesOf — ступени фото карточки в теле с message.media.
func photoSizesOf(msg map[string]any) []any {
	media, _ := msg["media"].(map[string]any)
	page, _ := media["webpage"].(map[string]any)
	photo, _ := page["photo"].(map[string]any)
	sizes, _ := photo["sizes"].([]any)
	return sizes
}

func hasSize(sizes []any, w, h float64) bool {
	for _, z := range sizes {
		if m, _ := z.(map[string]any); m["w"] == w && m["h"] == h {
			return true
		}
	}
	return false
}

// Размер фото — и в правке поста канала журналом канала, и в кадре
// отложенного (оба пути гидрируют сообщение до обработки медиа).
func TestWebPageFrame_PhotoSizeChannelAndScheduled(t *testing.T) {
	t.Run("пост канала", func(t *testing.T) {
		e := newChannelEnv(t)
		e.i.SetLinkPreviewer(&urlPreviewer{imageURL: "https://cdn.example/og.png"})
		e.i.SetBotHTTP(&fakeOutHTTP{data: pngOf(t, 800, 400), mime: "image/png"})
		e.i.SetBotMedia(&fakeMediaStore{})
		ctx := context.Background()
		if _, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "https://a.example/x"}); err != nil {
			t.Fatal(err)
		}
		e.i.bg.Wait()
		log := e.channelLog()
		d := bodyTag(t, log[len(log)-1].Payload)
		m, _ := d["message"].(map[string]any)
		if !hasSize(photoSizesOf(m), 800, 400) {
			t.Fatalf("правка поста: ступени %v", photoSizesOf(m))
		}
	})
	t.Run("отложенное", func(t *testing.T) {
		in, s, _, prev, cid := scheduledPreviewEnv(t)
		prev.imageURL = "https://cdn.example/og.png"
		in.SetBotHTTP(&fakeOutHTTP{data: pngOf(t, 800, 400), mime: "image/png"})
		in.SetBotMedia(&fakeMediaStore{})
		if _, err := in.Send(context.Background(), SendInput{ChatID: cid, SenderID: 1, Text: "https://a.example/x", ScheduleDate: future()}); err != nil {
			t.Fatal(err)
		}
		in.bg.Wait()
		news := logOf(s, 1, scheduledNewFrame)
		m, _ := news[len(news)-1]["message"].(map[string]any)
		if !hasSize(photoSizesOf(m), 800, 400) {
			t.Fatalf("кадр отложенного: ступени %v", photoSizesOf(m))
		}
	})
}

// Отправка после плашки с кириллицей в адресе: inputMediaWebPage.url — в
// процентной кодировке (webPage.url, appMessagesManager.ts:4872), кэш
// попадает, второй загрузки нет.
func TestSend_EncodedMediaURLHitsPlaqueCache(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	if e.in.GetWebPage(ctx, "https://a.example/путь") == nil {
		t.Fatal("плашка без карточки")
	}
	enc := "https://a.example/%D0%BF%D1%83%D1%82%D1%8C"
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/путь",
		WebPage: domain.WebPageInput{Media: &domain.InputMediaWebPage{Underscore: domain.InputMediaWebPageTag, URL: enc}}})
	e.in.bg.Wait()
	if storedMsg(t, e.s, msg.ID).WebPage == nil {
		t.Fatal("сообщение без карточки")
	}
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок %d; ждали 1", n)
	}
}
