package chat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeOutHTTP — исходящий HTTP (порт BotHTTP): отдаёт заданные байты/mime и
// запоминает, что и с каким лимитом просили.
type fakeOutHTTP struct {
	mu       sync.Mutex
	urls     []string
	maxBytes []int64
	data     []byte
	mime     string
	err      error
}

func (f *fakeOutHTTP) PostWebhook(context.Context, string, []byte) {}

func (f *fakeOutHTTP) FetchURL(_ context.Context, url string, maxBytes int64) ([]byte, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.urls = append(f.urls, url)
	f.maxBytes = append(f.maxBytes, maxBytes)
	return f.data, f.mime, f.err
}

func (f *fakeOutHTTP) calls() ([]string, []int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.urls...), append([]int64(nil), f.maxBytes...)
}

// fakeMediaStore — порт BotMediaStore: запоминает сохранённое и раздаёт id.
type fakeMediaStore struct {
	mu     sync.Mutex
	owners []int64
	mimes  []string
	names  []string
	sizes  []int
	nextID int64
}

func (f *fakeMediaStore) Store(_ context.Context, ownerID int64, mime, fileName string, data []byte) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.owners = append(f.owners, ownerID)
	f.mimes = append(f.mimes, mime)
	f.names = append(f.names, fileName)
	f.sizes = append(f.sizes, len(data))
	f.nextID++
	return 100 + f.nextID, nil
}

func (f *fakeMediaStore) stored() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.owners)
}

type fakeIVProber struct {
	has bool
	// hang — проба сидит до конца СВОЕГО бюджета (эмуляция медленного сайта).
	hang bool
}

func (f *fakeIVProber) HasArticle(ctx context.Context, _ string) bool {
	if f.hang {
		<-ctx.Done()
		return false
	}
	return f.has
}

// preview с картинкой og:image — то, что отдаёт разбор страницы.
func previewWithImage() *domain.WebPagePreview {
	return &domain.WebPagePreview{
		URL: "https://example.com/post", SiteName: "Example", Title: "Заголовок",
		ImageURL: "https://cdn.other-host.example/vi/abc/maxresdefault.jpg",
	}
}

func TestFetchPreviewPhoto_ProxiesToOurMedia(t *testing.T) {
	in, _ := newInteractor()
	http := &fakeOutHTTP{data: []byte("jpegbytes"), mime: "image/jpeg"}
	store := &fakeMediaStore{}
	in.SetBotHTTP(http)
	in.SetBotMedia(store)
	wp := previewWithImage()

	in.fetchPreviewPhoto(context.Background(), wp, 42)

	if wp.PhotoID != 101 {
		t.Fatalf("PhotoID = %d; want 101", wp.PhotoID)
	}
	// Чужой адрес наружу не уходит ни полем, ни в снимке.
	if wp.ImageURL != "" {
		t.Errorf("ImageURL = %q; должен быть погашен", wp.ImageURL)
	}
	urls, limits := http.calls()
	if len(urls) != 1 || urls[0] != "https://cdn.other-host.example/vi/abc/maxresdefault.jpg" {
		t.Errorf("FetchURL urls = %v", urls)
	}
	if len(limits) != 1 || limits[0] != maxPreviewPhoto {
		t.Errorf("FetchURL limits = %v; want %d", limits, maxPreviewPhoto)
	}
	if store.owners[0] != 42 || store.mimes[0] != "image/jpeg" || store.sizes[0] != len("jpegbytes") {
		t.Errorf("Store(owner=%d, mime=%q, size=%d)", store.owners[0], store.mimes[0], store.sizes[0])
	}
	// Имя файла — из ПУТИ ссылки, без query.
	if store.names[0] != "maxresdefault.jpg" {
		t.Errorf("file name = %q", store.names[0])
	}
}

func TestFetchPreviewPhoto_FileNameIgnoresQuery(t *testing.T) {
	in, _ := newInteractor()
	in.SetBotHTTP(&fakeOutHTTP{data: []byte("x"), mime: "image/png"})
	store := &fakeMediaStore{}
	in.SetBotMedia(store)
	wp := previewWithImage()
	wp.ImageURL = "https://cdn.example/img/cover.png?w=1200&sig=zzz"

	in.fetchPreviewPhoto(context.Background(), wp, 1)

	if store.names[0] != "cover.png" {
		t.Errorf("file name = %q; want cover.png", store.names[0])
	}
}

// Сайт отдал не картинку — сохранять нечего, карточка остаётся без фото.
func TestFetchPreviewPhoto_NonImageRejected(t *testing.T) {
	in, _ := newInteractor()
	in.SetBotHTTP(&fakeOutHTTP{data: []byte("<html>"), mime: "text/html"})
	store := &fakeMediaStore{}
	in.SetBotMedia(store)
	wp := previewWithImage()

	in.fetchPreviewPhoto(context.Background(), wp, 1)

	if wp.PhotoID != 0 || store.stored() != 0 {
		t.Fatalf("PhotoID = %d, stored = %d; ничего сохранять не должны", wp.PhotoID, store.stored())
	}
	if wp.ImageURL != "" {
		t.Errorf("ImageURL = %q; должен быть погашен и на отказе", wp.ImageURL)
	}
}

// Сеть/лимит подвели — превью всё равно остаётся, просто без картинки.
func TestFetchPreviewPhoto_FetchErrorIsSoft(t *testing.T) {
	in, _ := newInteractor()
	in.SetBotHTTP(&fakeOutHTTP{err: errors.New("too large")})
	store := &fakeMediaStore{}
	in.SetBotMedia(store)
	wp := previewWithImage()

	in.fetchPreviewPhoto(context.Background(), wp, 1)

	if wp.PhotoID != 0 || store.stored() != 0 {
		t.Fatalf("PhotoID = %d, stored = %d", wp.PhotoID, store.stored())
	}
}

// Хранилище медиа отключено (нет MinIO) — качать незачем.
func TestFetchPreviewPhoto_NoStoreNoFetch(t *testing.T) {
	in, _ := newInteractor()
	http := &fakeOutHTTP{data: []byte("x"), mime: "image/jpeg"}
	in.SetBotHTTP(http)
	wp := previewWithImage()

	in.fetchPreviewPhoto(context.Background(), wp, 1)

	if urls, _ := http.calls(); len(urls) != 0 {
		t.Fatalf("FetchURL вызван без хранилища: %v", urls)
	}
	if wp.PhotoID != 0 {
		t.Fatalf("PhotoID = %d", wp.PhotoID)
	}
}

// Снимок, который уезжает клиенту и в jsonb, чужого адреса не несёт.
func TestWebPagePreview_JSONHasNoForeignURL(t *testing.T) {
	b, err := json.Marshal(&domain.WebPagePreview{
		URL: "https://example.com/post", Title: "t",
		ImageURL: "https://cdn.other-host.example/og.png",
		PhotoID:  777,
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "other-host") || strings.Contains(string(b), "image_url") {
		t.Fatalf("снимок несёт чужой адрес: %s", b)
	}
	if !strings.Contains(string(b), `"photo_id":777`) {
		t.Fatalf("снимок без photo_id: %s", b)
	}
}

// Размеры и подложка картинки превью приезжают read-моделью из строки media:
// на момент записи снимка обработка ещё не отработала, в jsonb их нет.
func TestHydrateMedia_FillsWebPagePhoto(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	const photoID int64 = 555
	s.seedMedia(photoID, 1)
	s.seedMediaDims(photoID, domain.MediaSource{Width: 1280, Height: 720, Mime: "image/jpeg", Blur: []byte{1, 2, 3}, HasThumb: true})

	msgs := []domain.Message{{ID: 1, WebPage: &domain.WebPagePreview{URL: "https://example.com", PhotoID: photoID}}}
	if err := in.hydrateMedia(context.Background(), msgs); err != nil {
		t.Fatalf("hydrateMedia: %v", err)
	}

	wp := msgs[0].WebPage
	if wp.PhotoW != 1280 || wp.PhotoH != 720 {
		t.Errorf("dims = %dx%d", wp.PhotoW, wp.PhotoH)
	}
	if len(wp.PhotoBlur) != 3 || !wp.PhotoHasThumb {
		t.Errorf("blur = %v, hasThumb = %v", wp.PhotoBlur, wp.PhotoHasThumb)
	}
}

// Превью без картинки лишнего запроса не порождает и падать не должно.
func TestHydrateMedia_WebPageWithoutPhoto(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)

	msgs := []domain.Message{{ID: 1, WebPage: &domain.WebPagePreview{URL: "https://example.com"}}}
	if err := in.hydrateMedia(context.Background(), msgs); err != nil {
		t.Fatalf("hydrateMedia: %v", err)
	}
	if msgs[0].WebPage.PhotoW != 0 {
		t.Errorf("PhotoW = %d", msgs[0].WebPage.PhotoW)
	}
}

// Кнопка «Мгновенный просмотр» — только там, где статья реально извлекается.
func TestAttachWebPreview_IVFlagFromProber(t *testing.T) {
	for _, has := range []bool{true, false} {
		in, s := newInteractor()
		in.SetLinkPreviewer(&fakePreviewer{wp: &domain.WebPagePreview{URL: "https://example.com/post", Title: "t"}})
		in.SetIVProber(&fakeIVProber{has: has})
		ctx := context.Background()
		chatID, _ := in.CreatePrivateChat(ctx, 1, 2)
		msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "глянь https://example.com/post"})
		if err != nil {
			t.Fatalf("Send: %v", err)
		}
		waitFor(t, func() bool {
			stored, e := fakeMsgs{s}.GetByID(ctx, msg.ID)
			return e == nil && stored.WebPage != nil
		})
		stored, _ := fakeMsgs{s}.GetByID(ctx, msg.ID)
		if stored.WebPage.HasIV != has {
			t.Errorf("HasIV = %v; want %v", stored.WebPage.HasIV, has)
		}
	}
}

// ctxSpyMsgs подглядывает за контекстом, с которым приходит запись превью.
// Проверять «записалось ли» бесполезно: in-memory фейк контекст игнорирует и
// пишет даже по мёртвому — на настоящем pgx такой UPDATE просто не пройдёт.
// Поэтому смотрим на сам контекст (это и есть предмет решения).
type ctxSpyMsgs struct {
	MessageRepo
	mu       sync.Mutex
	writeErr error
	seen     bool
}

func (m *ctxSpyMsgs) SetWebPage(ctx context.Context, msgID int64, wp *domain.WebPagePreview) error {
	m.mu.Lock()
	m.writeErr, m.seen = ctx.Err(), true
	m.mu.Unlock()
	return m.MessageRepo.SetWebPage(ctx, msgID, wp)
}

func (m *ctxSpyMsgs) write() (error, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.writeErr, m.seen
}

// Обогащения не должны стоить нам карточки: медленная проба Instant View
// выедает свой бюджет целиком, а запись превью обязана прийти по ЖИВОМУ
// контексту. Дефект, который держит этот тест: один общий таймаут на весь цикл
// — тогда после долгой пробы контекст мёртв и UPDATE не проходит.
func TestAttachWebPreview_SlowIVProbeDoesNotLosePreview(t *testing.T) {
	defer swapBudgets(20*time.Millisecond, 20*time.Millisecond, 2*time.Second)()

	s := newStore()
	spy := &ctxSpyMsgs{MessageRepo: fakeMsgs{s}}
	in := New(fakeTx{}, fakeChats{s}, spy, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	in.SetLinkPreviewer(&fakePreviewer{wp: &domain.WebPagePreview{URL: "https://example.com/post", Title: "t"}})
	in.SetIVProber(&fakeIVProber{hang: true})
	ctx := context.Background()
	chatID, _ := in.CreatePrivateChat(ctx, 1, 2)

	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "глянь https://example.com/post"}); err != nil {
		t.Fatalf("Send: %v", err)
	}

	waitFor(t, func() bool { _, seen := spy.write(); return seen })
	if err, _ := spy.write(); err != nil {
		t.Fatalf("превью пишется по мёртвому контексту (%v) — обогащение съело бюджет записи", err)
	}
}

// swapBudgets ужимает бюджеты этапов на время теста и возвращает восстановитель.
func swapBudgets(preview, enrich, write time.Duration) func() {
	oldPreview, oldEnrich, oldWrite := previewTimeout, enrichTimeout, writeTimeout
	previewTimeout, enrichTimeout, writeTimeout = preview, enrich, write
	return func() { previewTimeout, enrichTimeout, writeTimeout = oldPreview, oldEnrich, oldWrite }
}

// Без пробы флага нет — кнопки на карточке тоже.
func TestAttachWebPreview_NoProberNoIV(t *testing.T) {
	in, s := newInteractor()
	in.SetLinkPreviewer(&fakePreviewer{wp: &domain.WebPagePreview{URL: "https://example.com/post", Title: "t"}})
	ctx := context.Background()
	chatID, _ := in.CreatePrivateChat(ctx, 1, 2)
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "глянь https://example.com/post"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	waitFor(t, func() bool {
		stored, e := fakeMsgs{s}.GetByID(ctx, msg.ID)
		return e == nil && stored.WebPage != nil
	})
	stored, _ := fakeMsgs{s}.GetByID(ctx, msg.ID)
	if stored.WebPage.HasIV {
		t.Error("HasIV=true без пробы")
	}
}
