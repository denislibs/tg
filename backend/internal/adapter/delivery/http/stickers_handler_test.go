package http

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/messenger-denis/backend/internal/domain"
	usecasestickers "github.com/messenger-denis/backend/internal/usecase/stickers"
)

// Стикер уезжает клиенту ДОКУМЕНТОМ схемы: своего типа у него нет вовсе
// (Р1 разбора). Метаданные файла при этом не исчезают, а переезжают туда, где
// им место у оригинала: размеры — в `documentAttributeImageSize`, эмодзи и
// набор — в `documentAttributeSticker`, превью и векторный контур — ступенями
// `thumbs`. Без них фронт не вписал бы стикер в бокс по пропорции, не выбрал
// бы рендерер до загрузки байтов и не показал бы нижний слой, пока файл летит.
//
// Байты ступеней едут base64-строкой — тем же способом, что blur_preview у
// медиа и avatar_preview у аватарок.
func TestStickerDocument_CarriesMediaMetadata(t *testing.T) {
	raw, err := json.Marshal(domain.StickerDocument(domain.Sticker{
		ID: 7, SetID: 3, MediaID: 42, Emoji: "😀", Position: 1,
		Width: 512, Height: 384, Mime: "image/webp", Size: 4096,
		Thumb: []byte{0xFF, 0xD8, 0xFF}, PathThumb: []byte{0x4D, 0x7A},
	}))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["_"] != "document" || got["id"] != float64(42) || got["mime_type"] != "image/webp" {
		t.Fatalf("документ = %#v", got)
	}
	if got["size"] != float64(4096) {
		t.Fatalf("size = %#v, want 4096", got["size"])
	}

	// Ступени: stripped-превью и векторный контур — в том же порядке, что у
	// вложения сообщения (их собирает общий BuildDocument).
	thumbs, _ := got["thumbs"].([]any)
	if len(thumbs) != 2 {
		t.Fatalf("ступеней %d, want 2 (stripped + контур): %#v", len(thumbs), got["thumbs"])
	}
	stripped, _ := thumbs[0].(map[string]any)
	path, _ := thumbs[1].(map[string]any)
	if stripped["_"] != "photoStrippedSize" || stripped["bytes"] != "/9j/" {
		t.Fatalf("stripped-ступень = %#v", stripped)
	}
	if path["_"] != "photoPathSize" || path["bytes"] != "TXo=" {
		t.Fatalf("ступень контура = %#v", path)
	}

	// Атрибуты: размеры кадра, затем эмодзи и НАБОР (Р3).
	//
	// ПОРЯДОК проверяется намеренно. Разбор документа идёт по атрибутам подряд,
	// и `documentAttributeImageSize` безусловно ставит `type='photo'` — стоя
	// ПОСЛЕ атрибута стикера, он затирает его, и разобранный стикер становится
	// документом-фотографией. У Telegram размер идёт первым; переставь их
	// местами — тест обязан покраснеть.
	attrs, _ := got["attributes"].([]any)
	if len(attrs) != 2 {
		t.Fatalf("атрибутов %d, want 2: %#v", len(attrs), got["attributes"])
	}
	size, _ := attrs[0].(map[string]any)
	if size["_"] != "documentAttributeImageSize" || size["w"] != float64(512) || size["h"] != float64(384) {
		t.Fatalf("первый атрибут = %#v, want размеры кадра", size)
	}
	st, _ := attrs[1].(map[string]any)
	if st["_"] != "documentAttributeSticker" || st["alt"] != "😀" {
		t.Fatalf("второй атрибут = %#v, want стикер", st)
	}
	set, _ := st["stickerset"].(map[string]any)
	if set["_"] != "inputStickerSetID" || set["id"] != float64(3) {
		t.Fatalf("набор в атрибуте = %#v", set)
	}
}

// Стикер, у медиа которого процессинг не отработал: ступеней и атрибута
// размеров нет вовсе — в схеме «неизвестно» это ОТСУТСТВИЕ элемента вектора, а
// не элемент с нулями. Клиент деградирует до квадрата без нижнего слоя.
//
// Набор при этом обязан остаться: он не из media, а из строки стикера.
func TestStickerDocument_NoMetadataMeansNoSizes(t *testing.T) {
	raw, err := json.Marshal(domain.StickerDocument(domain.Sticker{ID: 1, SetID: 4, MediaID: 2}))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := got["thumbs"]; ok {
		t.Fatalf("ступени приехали пустыми: %#v", got["thumbs"])
	}
	attrs, _ := got["attributes"].([]any)
	if len(attrs) != 1 {
		t.Fatalf("атрибутов %d, want 1 (только стикер): %#v", len(attrs), got["attributes"])
	}
	st, _ := attrs[0].(map[string]any)
	set, _ := st["stickerset"].(map[string]any)
	if set["_"] != "inputStickerSetID" || set["id"] != float64(4) {
		t.Fatalf("набор потерян: %#v", st)
	}
}

// Файл, не числящийся ни в одном наборе, обязан ехать с «набора нет», а не с
// подставленным нулём: ноль выглядел бы как настоящий адрес.
func TestStickerDocument_NoSetIsEmptyConstructor(t *testing.T) {
	raw, _ := json.Marshal(domain.StickerDocument(domain.Sticker{MediaID: 2}))
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	attrs, _ := got["attributes"].([]any)
	st, _ := attrs[0].(map[string]any)
	set, _ := st["stickerset"].(map[string]any)
	if set["_"] != "inputStickerSetEmpty" {
		t.Fatalf("адрес набора = %#v, want inputStickerSetEmpty", set)
	}
}

// featuredRepoStub — стаб порта stickers.Repo только под FeaturedSets и
// CoverStickers (Featured зовёт оба — наборы и их превью, covered sets):
// остальные методы (встроенный nil-интерфейс) в этом хендлере не вызываются.
type featuredRepoStub struct {
	usecasestickers.Repo
	sets   []domain.StickerSetRecord
	covers map[int64][]domain.Sticker
}

func (s *featuredRepoStub) FeaturedSets(context.Context, int64, int) ([]domain.StickerSetRecord, error) {
	return s.sets, nil
}

func (s *featuredRepoStub) CoverStickers(_ context.Context, setIDs []int64, _ int) (map[int64][]domain.Sticker, error) {
	out := map[int64][]domain.Sticker{}
	for _, id := range setIDs {
		if sts, ok := s.covers[id]; ok {
			out[id] = sts
		}
	}
	return out, nil
}

// GET /sticker-sets/featured: 200 с наборами из usecase в конверте {"sets": […]},
// а также превью каждого набора (covered sets) в "covers" — по ним строка
// поиска рисует силуэт стикеров, не дожидаясь отдельного похода за набором.
func TestFeatured_ReturnsSets(t *testing.T) {
	h := NewStickersHandler(usecasestickers.New(&featuredRepoStub{
		sets: []domain.StickerSetRecord{
			{ID: 2, Slug: "newer", Title: "Newer", Kind: "sticker", StickerCount: 5},
			{ID: 1, Slug: "older", Title: "Older", Kind: "sticker", StickerCount: 3},
		},
		covers: map[int64][]domain.Sticker{
			2: {{ID: 20, SetID: 2, MediaID: 200, Emoji: "😀"}},
		},
	}))

	w := httptest.NewRecorder()
	h.Featured(w, httptest.NewRequest("GET", "/sticker-sets/featured", nil))
	if w.Code != 200 {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	// Тренды — messages.featuredStickers: наборы едут вектором `sets`
	// конструкторов stickerSetFullCovered, и ПОРЯДОК вектора и есть порядок
	// выдачи (отдельного `rank` на проводе нет — Р8).
	var body coveredBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body %s)", err, w.Body.String())
	}
	if body.Underscore != "messages.featuredStickers" {
		t.Fatalf("конструктор = %q", body.Underscore)
	}
	if body.Count != 2 {
		t.Fatalf("count = %d, want 2", body.Count)
	}
	if len(body.Sets) != 2 || body.Sets[0].Set.ID != 2 || body.Sets[1].Set.ID != 1 {
		t.Fatalf("порядок наборов = %+v, want [2 1]", body.Sets)
	}
	if len(body.Sets[0].Documents) != 1 || body.Sets[0].Documents[0].ID != 200 {
		t.Fatalf("превью первого набора = %+v, want документ 200", body.Sets[0].Documents)
	}
	// Набор без превью — ПУСТОЙ вектор документов, а не отсутствие набора:
	// строка выдачи для него всё равно рисуется.
	if len(body.Sets[1].Documents) != 0 {
		t.Fatalf("превью второго набора = %+v, want пусто", body.Sets[1].Documents)
	}
}

// coveredBody — общий разбор ответа трендов и поиска: у обоих вектор
// `sets` из stickerSetFullCovered.
type coveredBody struct {
	Underscore string `json:"_"`
	Count      int    `json:"count"`
	Sets       []struct {
		Underscore string `json:"_"`
		Set        struct {
			ID        int64  `json:"id"`
			ShortName string `json:"short_name"`
		} `json:"set"`
		Documents []struct {
			ID int64 `json:"id"`
		} `json:"documents"`
		Packs []struct {
			Emoticon  string  `json:"emoticon"`
			Documents []int64 `json:"documents"`
		} `json:"packs"`
	} `json:"sets"`
}

// searchSetsRepoStub — стаб порта stickers.Repo под SearchSets и CoverStickers
// (SearchSets зовёт оба, тем же приёмом, что Featured).
type searchSetsRepoStub struct {
	usecasestickers.Repo
	sets   []domain.StickerSetRecord
	covers map[int64][]domain.Sticker
}

func (s *searchSetsRepoStub) SearchSets(context.Context, int64, string, int) ([]domain.StickerSetRecord, error) {
	return s.sets, nil
}

func (s *searchSetsRepoStub) CoverStickers(_ context.Context, setIDs []int64, _ int) (map[int64][]domain.Sticker, error) {
	out := map[int64][]domain.Sticker{}
	for _, id := range setIDs {
		if sts, ok := s.covers[id]; ok {
			out[id] = sts
		}
	}
	return out, nil
}

// GET /sticker-sets/search?q=: та же связка «наборы + covers», что у Featured —
// строка поиска не пуста до отдельного похода за полным набором.
func TestSearchSets_ReturnsCovers(t *testing.T) {
	h := NewStickersHandler(usecasestickers.New(&searchSetsRepoStub{
		sets: []domain.StickerSetRecord{{ID: 5, Slug: "duck_pack", Title: "Duck", Kind: "sticker"}},
		covers: map[int64][]domain.Sticker{
			5: {{ID: 50, SetID: 5, MediaID: 500, Emoji: "🦆"}},
		},
	}))

	w := httptest.NewRecorder()
	h.SearchSets(w, httptest.NewRequest("GET", "/sticker-sets/search?q=duck", nil))
	if w.Code != 200 {
		t.Fatalf("code = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
	// Поиск — СВОЙ конструктор (messages.foundStickerSets): у него нет ни
	// `count`, ни `unread`, и общий тип с трендами сказал бы «ноль наборов в
	// каталоге» там, где вопрос не задавался.
	var body coveredBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body %s)", err, w.Body.String())
	}
	if body.Underscore != "messages.foundStickerSets" {
		t.Fatalf("конструктор = %q", body.Underscore)
	}
	if len(body.Sets) != 1 || body.Sets[0].Set.ID != 5 || body.Sets[0].Set.ShortName != "duck_pack" {
		t.Fatalf("наборы = %+v", body.Sets)
	}
	if len(body.Sets[0].Documents) != 1 || body.Sets[0].Documents[0].ID != 500 {
		t.Fatalf("превью = %+v, want документ 500", body.Sets[0].Documents)
	}
	// Обратный индекс едет вместе с набором (Р6): подсказку по эмодзи клиент
	// считает сам, отдельного запроса к серверу для этого больше не нужно.
	if len(body.Sets[0].Packs) != 1 || body.Sets[0].Packs[0].Emoticon != "🦆" ||
		len(body.Sets[0].Packs[0].Documents) != 1 || body.Sets[0].Packs[0].Documents[0] != 500 {
		t.Fatalf("обратный индекс = %+v", body.Sets[0].Packs)
	}
}

// Пустая выдача — вектор нулевой длины, а не null: в схеме пустой Vector это
// вектор из нуля элементов, и клиент обходит его без гейта на null.
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
	if string(body["unread"]) != "[]" {
		t.Fatalf(`unread = %s, want []`, body["unread"])
	}
}

// installRepoStub — каталог из двух наборов и установки по пользователям:
// отдаёт срок установки ТОМУ, кто смотрит (viewerID), как SQL-реализация.
type installRepoStub struct {
	usecasestickers.Repo
	sets     []domain.StickerSetRecord
	installs map[int64]map[int64]time.Time // viewerID → setID → added_at
}

func (s *installRepoStub) forViewer(viewerID int64) []domain.StickerSetRecord {
	out := make([]domain.StickerSetRecord, 0, len(s.sets))
	for _, set := range s.sets {
		set.InstalledAt = s.installs[viewerID][set.ID]
		out = append(out, set)
	}
	return out
}

func (s *installRepoStub) FeaturedSets(_ context.Context, viewerID int64, _ int) ([]domain.StickerSetRecord, error) {
	return s.forViewer(viewerID), nil
}

func (s *installRepoStub) SearchSets(_ context.Context, viewerID int64, _ string, _ int) ([]domain.StickerSetRecord, error) {
	return s.forViewer(viewerID), nil
}

func (s *installRepoStub) SetByID(_ context.Context, viewerID, id int64) (domain.StickerSetRecord, error) {
	for _, set := range s.forViewer(viewerID) {
		if set.ID == id {
			return set, nil
		}
	}
	return domain.StickerSetRecord{}, domain.ErrNotFound
}

func (s *installRepoStub) SetBySlug(_ context.Context, viewerID int64, slug string) (domain.StickerSetRecord, error) {
	for _, set := range s.forViewer(viewerID) {
		if set.Slug == slug {
			return set, nil
		}
	}
	return domain.StickerSetRecord{}, domain.ErrNotFound
}

func (s *installRepoStub) Stickers(context.Context, int64) ([]domain.Sticker, error) { return nil, nil }

func (s *installRepoStub) CoverStickers(context.Context, []int64, int) (map[int64][]domain.Sticker, error) {
	return map[int64][]domain.Sticker{}, nil
}

// `stickerSet.installed_date` — параметр САМОГО набора (tweb
// isStickerSetAdded): тренды, поиск и набор по id/slug несут его для набора,
// который поставил ТОТ, кто спрашивает, — и только для него. У неустановленного
// ключа нет вовсе (flags-параметр), чужая установка не видна. Без поля вкладка
// поиска стикеров рисует установленный набор с кнопкой «Add».
func TestStickerSets_InstalledDateForViewer(t *testing.T) {
	const alice, bob = int64(42), int64(43)
	installedAt := time.Unix(1787334148, 0)
	h := NewStickersHandler(usecasestickers.New(&installRepoStub{
		sets: []domain.StickerSetRecord{
			{ID: 1, Slug: "mine", Title: "Mine", Kind: "sticker"},
			{ID: 2, Slug: "other", Title: "Other", Kind: "sticker"},
		},
		installs: map[int64]map[int64]time.Time{alice: {1: installedAt}},
	}))
	router := chi.NewRouter()
	router.Get("/sticker-sets/featured", h.Featured)
	router.Get("/sticker-sets/search", h.SearchSets)
	router.Get("/sticker-sets/id/{setID}", h.SetByID)
	router.Get("/sticker-sets/{slug}", h.SetBySlug)

	get := func(viewer int64, url string) []byte {
		t.Helper()
		req := httptest.NewRequest("GET", url, nil)
		req = req.WithContext(WithUser(req.Context(), domain.UserRecord{ID: viewer}, 0))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("%s: code = %d (body %s)", url, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	// installed — срок установки каждого набора выдачи; ключа нет → -1.
	installed := func(t *testing.T, raw []byte) map[int64]int64 {
		t.Helper()
		var body struct {
			Set  json.RawMessage   `json:"set"`
			Sets []json.RawMessage `json:"sets"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		var sets []map[string]json.RawMessage
		if body.Set != nil {
			var set map[string]json.RawMessage
			_ = json.Unmarshal(body.Set, &set)
			sets = append(sets, set)
		}
		for _, covered := range body.Sets {
			var c struct {
				Set map[string]json.RawMessage `json:"set"`
			}
			_ = json.Unmarshal(covered, &c)
			sets = append(sets, c.Set)
		}
		out := map[int64]int64{}
		for _, set := range sets {
			var id int64
			_ = json.Unmarshal(set["id"], &id)
			date := int64(-1)
			if v, ok := set["installed_date"]; ok {
				_ = json.Unmarshal(v, &date)
			}
			out[id] = date
		}
		return out
	}

	for _, url := range []string{
		"/sticker-sets/featured", "/sticker-sets/search?q=m",
		"/sticker-sets/id/1", "/sticker-sets/mine", "/sticker-sets/id/2",
	} {
		t.Run(url, func(t *testing.T) {
			mine := installed(t, get(alice, url))
			if v, ok := mine[1]; ok && v != installedAt.Unix() {
				t.Fatalf("Алиса: installed_date mine = %d, want %d", v, installedAt.Unix())
			}
			if v, ok := mine[2]; ok && v != -1 {
				t.Fatalf("Алиса: у неустановленного other installed_date = %d, want ключа нет", v)
			}
			for id, v := range installed(t, get(bob, url)) {
				if v != -1 {
					t.Fatalf("Боб: набор %d несёт чужую установку installed_date = %d", id, v)
				}
			}
		})
	}
	// Тренды и поиск — обе ветки сразу: установленный рядом с неустановленным.
	if got := installed(t, get(alice, "/sticker-sets/featured")); got[1] != installedAt.Unix() || got[2] != -1 {
		t.Fatalf("тренды Алисы = %v, want {1: %d, 2: нет}", got, installedAt.Unix())
	}
}
