package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
	usecasestickers "github.com/messenger-denis/backend/internal/usecase/stickers"
)

// Представление стикера для клиента: кроме идентификаторов обязаны ехать
// метаданные файла. Без width/height фронт не может вписать стикер в бокс по
// пропорции, без mime — выбрать рендерер до загрузки байтов, без thumb — показать
// нижний слой, пока файл летит. Байты превью едут base64-строкой — тем же
// способом, что blur_preview у медиа и avatar_preview у аватарок.
func TestStickersJSON_CarriesMediaMetadata(t *testing.T) {
	raw, err := json.Marshal(stickersJSON([]domain.Sticker{{
		ID: 7, SetID: 3, MediaID: 42, Emoji: "😀", Position: 1,
		Width: 512, Height: 384, Mime: "image/webp", Thumb: []byte{0xFF, 0xD8, 0xFF},
	}}))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got []map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("получено %d элементов, want 1", len(got))
	}

	want := map[string]any{
		"id": float64(7), "set_id": float64(3), "media_id": float64(42), "emoji": "😀",
		"width": float64(512), "height": float64(384), "mime": "image/webp",
		"thumb": "/9j/", // base64 от {0xFF,0xD8,0xFF}
	}
	for k, v := range want {
		if got[0][k] != v {
			t.Fatalf("поле %q = %#v, want %#v", k, got[0][k], v)
		}
	}
}

// Стикер, у медиа которого процессинг не отработал: поля обязаны присутствовать
// с нулевыми значениями, а не исчезать — клиент отличает «нет превью» от
// «поле не приехало» и деградирует до квадрата без нижнего слоя.
func TestStickersJSON_EmptyMetadataStaysPresent(t *testing.T) {
	raw, err := json.Marshal(stickersJSON([]domain.Sticker{{ID: 1, SetID: 1, MediaID: 2, Emoji: ""}}))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got []map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, k := range []string{"width", "height", "mime", "thumb"} {
		if _, ok := got[0][k]; !ok {
			t.Fatalf("поле %q пропало из ответа", k)
		}
	}
	if got[0]["width"] != float64(0) || got[0]["height"] != float64(0) {
		t.Fatalf("размеры %v/%v, want 0/0", got[0]["width"], got[0]["height"])
	}
	if got[0]["thumb"] != nil {
		t.Fatalf("thumb = %#v, want null", got[0]["thumb"])
	}
}

// featuredRepoStub — стаб порта stickers.Repo только под FeaturedSets: остальные
// методы (встроенный nil-интерфейс) в этом хендлере не вызываются.
type featuredRepoStub struct {
	usecasestickers.Repo
	sets []domain.StickerSet
}

func (s *featuredRepoStub) FeaturedSets(context.Context, int) ([]domain.StickerSet, error) {
	return s.sets, nil
}

// GET /sticker-sets/featured: 200 с наборами из usecase в конверте {"sets": […]}.
func TestFeatured_ReturnsSets(t *testing.T) {
	h := NewStickersHandler(usecasestickers.New(&featuredRepoStub{sets: []domain.StickerSet{
		{ID: 2, Slug: "newer", Title: "Newer", Kind: "sticker", StickerCount: 5},
		{ID: 1, Slug: "older", Title: "Older", Kind: "sticker", StickerCount: 3},
	}}))

	w := httptest.NewRecorder()
	h.Featured(w, httptest.NewRequest("GET", "/sticker-sets/featured", nil))
	if w.Code != 200 {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	var body struct {
		Sets []domain.StickerSet `json:"sets"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body %s)", err, w.Body.String())
	}
	if len(body.Sets) != 2 || body.Sets[0].ID != 2 || body.Sets[1].ID != 1 {
		t.Fatalf("sets = %+v, want порядок репозитория [2 1]", body.Sets)
	}
}

// setByMediaIDRepoStub — стаб порта stickers.Repo только под SetByMediaID.
type setByMediaIDRepoStub struct {
	usecasestickers.Repo
	set domain.StickerSet
	err error
}

func (s *setByMediaIDRepoStub) SetByMediaID(context.Context, int64) (domain.StickerSet, error) {
	return s.set, s.err
}

// requestWithMediaID — httptest-запрос с chi-параметром {mediaID}, как если бы
// его положил роутер (в тесте хендлер зовётся напрямую, без реального роутера).
func requestWithMediaID(mediaID string) *http.Request {
	r := httptest.NewRequest("GET", "/stickers/by-media/"+mediaID, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("mediaID", mediaID)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// GET /stickers/by-media/{mediaID}: медиа принадлежит набору → 200 с набором
// в конверте {"set": …} (клик по стикеру в чате, ConvMsg несёт только media_id).
func TestSetByMediaID_Found(t *testing.T) {
	h := NewStickersHandler(usecasestickers.New(&setByMediaIDRepoStub{
		set: domain.StickerSet{ID: 7, Slug: "utyaduck", Title: "Duck", Kind: "sticker"},
	}))

	w := httptest.NewRecorder()
	h.SetByMediaID(w, requestWithMediaID("42"))
	if w.Code != 200 {
		t.Fatalf("code = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
	var body struct {
		Set domain.StickerSet `json:"set"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.Set.Slug != "utyaduck" {
		t.Fatalf("set.slug = %q, want utyaduck", body.Set.Slug)
	}
}

// Медиа без набора (не стикер / стикер удалён) → 404, как и остальные
// stickers-ручки на domain.ErrNotFound.
func TestSetByMediaID_NotFound(t *testing.T) {
	h := NewStickersHandler(usecasestickers.New(&setByMediaIDRepoStub{err: domain.ErrNotFound}))

	w := httptest.NewRecorder()
	h.SetByMediaID(w, requestWithMediaID("999999"))
	if w.Code != 404 {
		t.Fatalf("code = %d, want 404 (body %s)", w.Code, w.Body.String())
	}
}

// Нечисловой mediaID в пути → 400, как у остальных pathInt-ручек.
func TestSetByMediaID_BadParam(t *testing.T) {
	h := NewStickersHandler(usecasestickers.New(&setByMediaIDRepoStub{}))

	w := httptest.NewRecorder()
	h.SetByMediaID(w, requestWithMediaID("not-a-number"))
	if w.Code != 400 {
		t.Fatalf("code = %d, want 400 (body %s)", w.Code, w.Body.String())
	}
}

// Пустая выдача сериализуется как [], а не null — клиент мапит r.sets ?? [].
func TestFeatured_EmptyIsArray(t *testing.T) {
	h := NewStickersHandler(usecasestickers.New(&featuredRepoStub{}))

	w := httptest.NewRecorder()
	h.Featured(w, httptest.NewRequest("GET", "/sticker-sets/featured", nil))
	if w.Code != 200 {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if string(body["sets"]) != "[]" {
		t.Fatalf(`sets = %s, want []`, body["sets"])
	}
}
