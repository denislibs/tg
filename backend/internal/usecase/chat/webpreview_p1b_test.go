package chat

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
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
	e.prev.imageURL = "https://cdn.example/og.png"
	ctx := context.Background()
	raw := "https://a.example/путь"
	if wp := e.in.GetWebPage(ctx, raw); wp == nil || wp.ImageURL != "" {
		t.Fatalf("плашка = %+v", wp)
	}
	if wp := e.in.GetWebPage(ctx, raw); wp == nil || wp.ImageURL != "" {
		t.Fatalf("плашка из кэша = %+v", wp)
	}
	page, _ := e.in.webPages.pageEntry("https://a.example/%D0%BF%D1%83%D1%82%D1%8C")
	if page == nil || page.ImageURL == "" {
		t.Fatalf("страница для сборки = %+v; ждали адрес картинки", page)
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
	e.in.webPages.mu.Lock()
	e.in.webPages.onWait = func() { waiting <- struct{}{} }
	e.in.webPages.mu.Unlock()
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
	waiting atomic.Int32 // сколько запросов заголовка ждут release
}

func (h *slowHeadHTTP) FetchPrefix(ctx context.Context, url string, maxBytes int64) ([]byte, string, error) {
	h.waiting.Add(1)
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
	// Страница легла в кэш (ещё недостроенной для плашки) — сборке её хватает.
	waitFor(t, func() bool { _, ok := e.in.webPages.pageEntry(u); return ok })
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

// Временный сбой плашки (она не повторяет загрузку) не запоминается:
// следующий запрос того же адреса снова идёт на сайт.
func TestGetWebPage_TransientNotCached(t *testing.T) {
	e := newPreviewEnv(t)
	e.prev.fail = 1
	ctx := context.Background()
	const u = "https://a.example/x"
	if e.in.GetWebPage(ctx, u) != nil {
		t.Fatal("карточка при сбое")
	}
	if e.in.GetWebPage(ctx, u) == nil {
		t.Fatal("временный сбой плашки закэширован")
	}
}

// expireCacheEntry — срок записи кэша истёк.
func expireCacheEntry(in *Interactor, u string) {
	in.webPages.mu.Lock()
	defer in.webPages.mu.Unlock()
	k := cacheKey(u)
	e := in.webPages.m[k]
	e.expires = time.Now().Add(-time.Second)
	in.webPages.m[k] = e
}

// Отказ по существу живёт webPageRefusalTTL; после срока — новая загрузка.
func TestWebPageCache_RefusalExpires(t *testing.T) {
	e := newPreviewEnv(t)
	e.prev.permanent = true
	ctx := context.Background()
	const u = "https://a.example/file.pdf"
	e.in.GetWebPage(ctx, u)
	e.in.webPages.mu.Lock()
	left := time.Until(e.in.webPages.m[cacheKey(u)].expires)
	e.in.webPages.mu.Unlock()
	if left > webPageRefusalTTL || left < webPageRefusalTTL-time.Second {
		t.Fatalf("срок отказа %v; ждали %v", left, webPageRefusalTTL)
	}
	expireCacheEntry(e.in, u)
	e.in.GetWebPage(ctx, u)
	if n := len(e.prev.calls()); n != 2 {
		t.Fatalf("после срока отказа загрузок %d; ждали 2", n)
	}
}

// Ссылка с парными скобками (Википедия) — целиком, непарная скобка и
// пунктуация — не часть ссылки.
func TestFirstURL_Parens(t *testing.T) {
	for in, want := range map[string]string{
		"см. https://ru.wikipedia.org/wiki/X_(y)": "https://ru.wikipedia.org/wiki/X_(y)",
		"(см. https://a.example/c)":               "https://a.example/c",
		"смотри https://a.example/c.":             "https://a.example/c",
		"https://ru.wikipedia.org/wiki/X_(y)).":   "https://ru.wikipedia.org/wiki/X_(y)",
		"Зацени https://example.com!":             "https://example.com",
		"«https://ya.ru»":                         "https://ya.ru",
		"https://google.com?q=1":                  "https://google.com",
		"https://a.example:8443/p?q=1!":           "https://a.example:8443/p?q=1!",
		"путь https://a.example/путь/x»":          "https://a.example/путь/x»",
		"HTTPS://A.example/x":                     "", // tweb: схема плашки — в нижнем регистре (input.ts:3570)
		"адрес https://localhost/x":               "",
		"ip https://1.2.3.4/x":                    "https://1.2.3.4/x",
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

// Метка загрузки плашки снимается ровно один раз и не остаётся после
// ответа: иначе каждая сборка этого адреса ждала бы чужую «загрузку» до конца
// своего бюджета (так висел TestWebPageCache_KeyAndLeaks).
func TestGetWebPage_LoadingMarkCleared(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	for _, u := range []string{"https://a.example/x", "https://a.example/x", "https://b.example/y"} {
		e.in.GetWebPage(ctx, u)
	}
	e.prev.fail = 1
	e.in.GetWebPage(ctx, "https://c.example/z")
	e.in.webPages.mu.Lock()
	n := len(e.in.webPages.loading)
	e.in.webPages.mu.Unlock()
	if n != 0 {
		t.Fatalf("меток загрузки осталось %d", n)
	}
	done := make(chan struct{})
	go func() { e.in.webPages.waitLoading(ctx, "https://a.example/x"); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("page() ждёт снятую загрузку")
	}
}

// Ревью 3, п.9: отказ по существу, уже полученный плашкой (404, не HTML),
// сборка не повторяет — второго запроса к сайту нет.
func TestBuildWebPreview_UsesPlaqueRefusal(t *testing.T) {
	e := newPreviewEnv(t)
	e.prev.permanent = true
	ctx := context.Background()
	if e.in.GetWebPage(ctx, "https://a.example/file.pdf") != nil {
		t.Fatal("карточка у отказа")
	}
	e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/file.pdf"})
	e.in.bg.Wait()
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок %d; ждали 1 (только плашка)", n)
	}
}

// Ревью 3, п.10: две плашки одного адреса — одна загрузка страницы.
func TestGetWebPage_ConcurrentPlaquesShareLoad(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	const u = "https://slow.example/x"
	release := e.prev.hold(u)
	res := make(chan *domain.WebPagePreview, 2)
	go func() { res <- e.in.GetWebPage(ctx, u) }()
	waitFor(t, func() bool { return len(e.prev.calls()) == 1 })
	waiting := make(chan struct{}, 1)
	e.in.webPages.mu.Lock()
	e.in.webPages.onWait = func() { waiting <- struct{}{} }
	e.in.webPages.mu.Unlock()
	go func() { res <- e.in.GetWebPage(ctx, u) }()
	<-waiting // вторая плашка встала ждать первую
	close(release)
	for k := 0; k < 2; k++ {
		if wp := <-res; wp == nil {
			t.Fatal("плашка без карточки")
		}
	}
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок %d; ждали 1", n)
	}
}

// panicIVProber — проба Instant View, падающая паникой (чужой HTML).
type panicIVProber struct{}

func (panicIVProber) HasArticle(context.Context, string) bool { panic("readability") }

// Ревью 4, п.1: паника в сборке возвращает слот семафора.
func TestBuildWebPreview_PanicReturnsSlot(t *testing.T) {
	e := newPreviewEnv(t)
	e.in.SetIVProber(panicIVProber{})
	e.in.Send(context.Background(), SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x"})
	e.in.bg.Wait()
	if n := len(e.in.previewFlights.slots); n != 0 {
		t.Fatalf("занято слотов после паники: %d", n)
	}
}

// Все слоты заняты дольше previewTimeout — сборка не начинается (и не висит).
func TestBuildWebPreview_SlotTimeout(t *testing.T) {
	defer swapBudgets(20*time.Millisecond, 20*time.Millisecond, time.Second)()
	e := newPreviewEnv(t)
	e.in.previewFlights.acquireBuild()
	for k := 1; k < buildSlots; k++ {
		e.in.previewFlights.slots <- struct{}{}
	}
	msg, _ := e.in.Send(context.Background(), SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x"})
	e.in.bg.Wait()
	if storedMsg(t, e.s, msg.ID).WebPage != nil || len(e.prev.calls()) != 0 {
		t.Fatal("сборка прошла без слота")
	}
}

// failCommitTx — транзакция, у которой падает коммит (fn отработал).
type failCommitTx struct{}

func (failCommitTx) WithinTx(ctx context.Context, fn func(context.Context) error) error {
	if err := fn(ctx); err != nil {
		return err
	}
	return errors.New("commit failed")
}

// Ревью 3/4: упавший коммит записи карточки — кадра нет (карточка откачена).
func TestWebPageFrame_NotSentWhenCommitFails(t *testing.T) {
	e := newPreviewEnv(t)
	release := e.prev.hold("https://a.example/x")
	e.in.Send(context.Background(), SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x"})
	waitFor(t, func() bool { return len(e.prev.calls()) == 1 })
	e.in.tx = failCommitTx{}
	close(release)
	e.in.bg.Wait()
	if n := countFrames(e.pub, 2, "web_page_update"); n != 0 {
		t.Fatalf("кадров карточки %d при упавшем коммите", n)
	}
}

// Ревью 4, п.3: вторая плашка, пока первая читает заголовок картинки, —
// страница не грузится второй раз.
func TestGetWebPage_SecondPlaqueDuringImageHead(t *testing.T) {
	e := newPreviewEnv(t)
	head := &slowHeadHTTP{fakeOutHTTP: fakeOutHTTP{data: pngOf(t, 800, 400), mime: "image/png"}, release: make(chan struct{})}
	e.in.SetBotHTTP(head)
	e.in.SetBotMedia(&fakeMediaStore{})
	e.prev.imageURL = "https://cdn.example/og.png"
	ctx := context.Background()
	const u = "https://a.example/x"
	res := make(chan *domain.WebPagePreview, 2)
	go func() { res <- e.in.GetWebPage(ctx, u) }()
	waitFor(t, func() bool { _, ok := e.in.webPages.pageEntry(u); return ok })
	go func() { res <- e.in.GetWebPage(ctx, u) }()
	// Обе плашки читают заголовок картинки: вторая — по странице из кэша.
	waitFor(t, func() bool { return head.waiting.Load() == 2 })
	close(head.release)
	for k := 0; k < 2; k++ {
		if wp := <-res; wp == nil || !wp.HasLargeMedia {
			t.Fatalf("плашка = %+v", wp)
		}
	}
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок страницы %d; ждали 1", n)
	}
}

// Ревью 4, п.4: одна ссылка в нескольких сообщениях (бот шлёт во много
// чатов) — одна загрузка страницы на все сборки.
func TestBuildWebPreview_SameURLBuildsShareLoad(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	const u = "https://slow.example/x"
	release := e.prev.hold(u)
	waiting := make(chan struct{}, 4)
	e.in.webPages.mu.Lock()
	e.in.webPages.onWait = func() { waiting <- struct{}{} }
	e.in.webPages.mu.Unlock()
	a, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: u})
	waitFor(t, func() bool { return len(e.prev.calls()) == 1 })
	b, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 2, Text: u})
	<-waiting // вторая сборка ждёт первую
	close(release)
	e.in.bg.Wait()
	for _, m := range []domain.Message{a, b} {
		if storedMsg(t, e.s, m.ID).WebPage == nil {
			t.Fatalf("сообщение %d без карточки", m.ID)
		}
	}
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок страницы %d; ждали 1", n)
	}
}

// slowFullHTTP — картинка целиком (FetchURL сборки) отдаётся только по
// release; заголовок (FetchPrefix плашки) — сразу.
type slowFullHTTP struct {
	fakeOutHTTP
	release chan struct{}
}

func (h *slowFullHTTP) FetchURL(ctx context.Context, url string, maxBytes int64) ([]byte, string, error) {
	select {
	case <-h.release:
	case <-ctx.Done():
		return nil, "", ctx.Err()
	}
	return h.fakeOutHTTP.FetchURL(ctx, url, maxBytes)
}

func (h *slowFullHTTP) FetchPrefix(ctx context.Context, url string, maxBytes int64) ([]byte, string, error) {
	return h.fakeOutHTTP.FetchURL(ctx, url, maxBytes)
}

// Ревью 5, п.1: плашка, пришедшая во время обогащения сборки (картинка,
// проба IV), не ждёт его — страница уже в кэше, метка снята.
func TestGetWebPage_DoesNotWaitBuildEnrichment(t *testing.T) {
	e := newPreviewEnv(t)
	img := &slowFullHTTP{fakeOutHTTP: fakeOutHTTP{data: pngOf(t, 800, 400), mime: "image/png"}, release: make(chan struct{})}
	e.in.SetBotHTTP(img)
	e.in.SetBotMedia(&fakeMediaStore{})
	e.prev.imageURL = "https://cdn.example/og.png"
	ctx := context.Background()
	const u = "https://a.example/x"
	e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: u})
	waitFor(t, func() bool { _, ok := e.in.webPages.pageEntry(u); return ok })
	got := make(chan *domain.WebPagePreview, 1)
	go func() { got <- e.in.GetWebPage(ctx, u) }()
	select {
	case wp := <-got:
		if wp == nil {
			t.Fatal("плашка без карточки")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("плашка ждёт обогащение сборки")
	}
	close(img.release)
	e.in.bg.Wait()
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок страницы %d; ждали 1", n)
	}
}

// Ревью 5, пп.2-3: десять сборок одной ссылки на медленном сайте — одна
// загрузка страницы (при временном сбое — ещё одна, повтор загрузившего), и
// ждущие не держат слоты семафора.
func TestBuildWebPreview_SlowSiteHerd(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	const u = "https://slow.example/x"
	release := e.prev.hold(u)
	for k := 0; k < 10; k++ {
		e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: u})
	}
	waitFor(t, func() bool { return len(e.prev.calls()) == 1 })
	time.Sleep(50 * time.Millisecond) // остальные девять дошли до ожидания
	if n := len(e.in.previewFlights.slots); n > 1 {
		t.Fatalf("слотов занято %d при одной загрузке в сети", n)
	}
	close(release)
	e.in.bg.Wait()
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("загрузок страницы %d; ждали 1", n)
	}
}

// failingGetMsgs — GetByID падает fails раз (сбой БД), дальше — как обычно.
type failingGetMsgs struct {
	MessageRepo
	mu    sync.Mutex
	fails int
}

func (m *failingGetMsgs) GetByID(ctx context.Context, id int64) (domain.Message, error) {
	m.mu.Lock()
	fail := m.fails > 0
	if fail {
		m.fails--
	}
	m.mu.Unlock()
	if fail {
		return domain.Message{}, errors.New("db: connection reset")
	}
	return m.MessageRepo.GetByID(ctx, id)
}

// Ревью 4, п.9: один сбой чтения строки перед записью — повтор, карточка
// записана; два — карточки нет, но и ложного «правили».
func TestAttachWebPreview_ReadFailureRetried(t *testing.T) {
	for _, c := range []struct {
		fails int
		want  bool
	}{{1, true}, {2, false}} {
		e := newPreviewEnv(t)
		e.in.SetBotHTTP(&fakeOutHTTP{data: pngOf(t, 800, 400), mime: "image/png"})
		e.in.SetBotMedia(&fakeMediaStore{})
		e.prev.imageURL = "https://cdn.example/og.png"
		release := e.prev.hold("https://a.example/x")
		msg, _ := e.in.Send(context.Background(), SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x"})
		waitFor(t, func() bool { return len(e.prev.calls()) == 1 })
		fm := &failingGetMsgs{MessageRepo: e.in.msgs, fails: c.fails}
		e.in.msgs = fm
		close(release)
		e.in.bg.Wait()
		if got := storedMsg(t, e.s, msg.ID).WebPage != nil; got != c.want {
			t.Fatalf("сбоев чтения %d: карточка %v; ждали %v", c.fails, got, c.want)
		}
	}
}

// Порядок ссылок как у tweb (input.ts:3563-3577): первая по положению среди
// text_url и голых ссылок; смещения сущностей — UTF-16.
func TestFirstURL_OrderAndForms(t *testing.T) {
	text := "😀 см. https://a.example и ссылка"
	// «ссылка» — text_url на b.example ПОСЛЕ голой ссылки.
	after := domain.MessageEntities{domain.NewMessageEntityTextURL(utf16Len("😀 см. https://a.example и "), 6, "https://b.example")}
	if got := firstURL(text, after); got != "https://a.example" {
		t.Errorf("text_url после голой: %q", got)
	}
	before := domain.MessageEntities{domain.NewMessageEntityTextURL(0, 2, "https://b.example")}
	if got := firstURL(text, before); got != "https://b.example" {
		t.Errorf("text_url до голой: %q", got)
	}
	for in, want := range map[string]string{
		"https://user:pw@a.example/p":   "https://user:pw@a.example/p",
		"https://a.example:8080 и":      "https://a.example:8080",
		"https://xn--d1acufc.xn--p1ai/": "https://xn--d1acufc.xn--p1ai/",
	} {
		if got := firstURL(in, nil); got != want {
			t.Errorf("%q → %q; want %q", in, got, want)
		}
	}
}

// panicPreviewer — разбор чужой страницы падает паникой.
type panicPreviewer struct{ calls atomic.Int32 }

func (p *panicPreviewer) Preview(context.Context, string) (*domain.WebPagePreview, error) {
	if p.calls.Add(1) == 1 {
		panic("html")
	}
	return &domain.WebPagePreview{URL: "https://a.example/x", Title: "T"}, nil
}

// Ревью 6, п.1: паника разбора страницы в сборке снимает метку загрузки и
// возвращает слот — адрес не мертвеет до рестарта.
func TestLoadPage_PanicReleasesMarkAndSlot(t *testing.T) {
	e := newPreviewEnv(t)
	pp := &panicPreviewer{}
	e.in.SetLinkPreviewer(pp)
	e.in.Send(context.Background(), SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x"})
	e.in.bg.Wait()
	if e.in.webPages.loadingNow("https://a.example/x") || len(e.in.previewFlights.slots) != 0 {
		t.Fatal("после паники осталась метка загрузки или слот")
	}
	if e.in.GetWebPage(context.Background(), "https://a.example/x") == nil {
		t.Fatal("плашка после паники не грузит")
	}
}

// Ревью 6, п.2: временный сбой плашки (без повтора) не лишает сообщение
// своей загрузки с повтором.
func TestBuildWebPreview_PlaqueTransientNotInherited(t *testing.T) {
	old := pageRetryDelay
	pageRetryDelay = time.Millisecond
	defer func() { pageRetryDelay = old }()
	e := newPreviewEnv(t)
	e.prev.fail = 1
	ctx := context.Background()
	if e.in.GetWebPage(ctx, "https://a.example/x") != nil {
		t.Fatal("карточка при сбое")
	}
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x"})
	e.in.bg.Wait()
	if storedMsg(t, e.s, msg.ID).WebPage == nil {
		t.Fatal("сообщение без карточки после сбоя плашки")
	}
}

// Ревью 6, п.3: слот на обогащение не дали — карточка уходит без картинки,
// а не теряется.
func TestBuildWebPreview_EnrichSlotTimeoutKeepsCard(t *testing.T) {
	defer swapBudgets(30*time.Millisecond, 30*time.Millisecond, time.Second)()
	e := newPreviewEnv(t)
	ctx := context.Background()
	const u = "https://a.example/x"
	if e.in.GetWebPage(ctx, u) == nil { // страница в кэше от плашки
		t.Fatal("плашка без карточки")
	}
	for k := 0; k < buildSlots; k++ {
		e.in.previewFlights.acquireBuild()
	}
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: u})
	e.in.bg.Wait()
	for k := 0; k < buildSlots; k++ {
		e.in.previewFlights.releaseBuild()
	}
	if storedMsg(t, e.s, msg.ID).WebPage == nil {
		t.Fatal("карточка потеряна из-за очереди обогащения")
	}
}

// Ревью 6, п.4: очередь фоновых сборок полна — плашка этого адреса не ждёт
// её (держатель метки занимает её только со слотом на руках).
func TestGetWebPage_DoesNotWaitBuildQueue(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	const u = "https://a.example/x"
	for k := 0; k < buildSlots; k++ {
		e.in.previewFlights.acquireBuild()
	}
	e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: u})
	time.Sleep(20 * time.Millisecond) // сборка встала в очередь слотов
	got := make(chan *domain.WebPagePreview, 1)
	go func() { got <- e.in.GetWebPage(ctx, u) }()
	select {
	case wp := <-got:
		if wp == nil {
			t.Fatal("плашка без карточки")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("плашка ждёт очередь фоновых сборок")
	}
	for k := 0; k < buildSlots; k++ {
		e.in.previewFlights.releaseBuild()
	}
	e.in.bg.Wait()
}

// Ревью 5-6: достройка карточки не продлевает срок страницы и не создаёт
// запись поверх истёкшей; отказ поверх живой страницы — свой короткий срок.
func TestWebPageCache_ExpiryRules(t *testing.T) {
	var c webPageCache
	const u = "https://a.example/x"
	c.putPage(u, &domain.WebPagePreview{URL: u}, false)
	c.mu.Lock()
	first := c.m[cacheKey(u)].expires
	c.mu.Unlock()
	time.Sleep(5 * time.Millisecond)
	c.put(u, &domain.WebPagePreview{URL: u, HasLargeMedia: true}, true)
	c.mu.Lock()
	if got := c.m[cacheKey(u)].expires; !got.Equal(first) {
		t.Fatalf("достройка продлила срок: %v → %v", first, got)
	}
	e := c.m[cacheKey(u)]
	e.expires = time.Now().Add(-time.Second)
	c.m[cacheKey(u)] = e
	c.mu.Unlock()
	c.put(u, &domain.WebPagePreview{URL: u}, true)
	if _, ok := c.get(u); ok {
		t.Fatal("достройка создала запись поверх истёкшей")
	}
	c.putPage(u, &domain.WebPagePreview{URL: u}, false)
	c.putPage(u, nil, true)
	c.mu.Lock()
	left := time.Until(c.m[cacheKey(u)].expires)
	c.mu.Unlock()
	if left > webPageTransientTTL {
		t.Fatalf("сбой унаследовал срок страницы: %v", left)
	}
}

// failHeadHTTP — заголовок картинки не читается (сбой CDN).
type failHeadHTTP struct{ fakeOutHTTP }

func (*failHeadHTTP) FetchPrefix(context.Context, string, int64) ([]byte, string, error) {
	return nil, "", errors.New("cdn timeout")
}

// Размер картинки плашки не прочитан — карточка не запоминается
// достроенной: следующая плашка достраивает её снова.
func TestGetWebPage_HeadFailureLeavesIncomplete(t *testing.T) {
	e := newPreviewEnv(t)
	e.in.SetBotHTTP(&failHeadHTTP{})
	e.prev.imageURL = "https://cdn.example/og.png"
	ctx := context.Background()
	const u = "https://a.example/x"
	if e.in.GetWebPage(ctx, u) == nil {
		t.Fatal("плашка без карточки")
	}
	if _, ok := e.in.webPages.get(u); ok {
		t.Fatal("карточка без прочитанного размера запомнена достроенной")
	}
}

// Ссылка внутри code/pre — не ссылка (как у tweb).
func TestFirstURL_SkipsCode(t *testing.T) {
	text := "код https://a.example/x и https://b.example/y"
	code := domain.MessageEntities{domain.NewMessageEntityCode(4, utf16Len("https://a.example/x"))}
	if got := firstURL(text, code); got != "https://b.example/y" {
		t.Fatalf("ссылка в code: %q", got)
	}
}
