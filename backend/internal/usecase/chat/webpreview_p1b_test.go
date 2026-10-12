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
	page := e.in.webPages.page("https://a.example/%D0%BF%D1%83%D1%82%D1%8C")
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
