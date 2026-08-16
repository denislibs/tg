package http

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

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
