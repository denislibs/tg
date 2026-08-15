package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
	usecasestickers "github.com/messenger-denis/backend/internal/usecase/stickers"
)

// StickersHandler — HTTP для стикеров и GIF: только парсинг/сериализация,
// логика в usecase/stickers.
type StickersHandler struct{ svc *usecasestickers.Interactor }

func NewStickersHandler(svc *usecasestickers.Interactor) *StickersHandler {
	return &StickersHandler{svc: svc}
}

func (h *StickersHandler) meID(r *http.Request) int64 {
	u, _ := UserFromContext(r.Context())
	return u.ID
}

// stickersJSON — представление стикера для клиента. Кроме идентификаторов едут
// метаданные файла (см. domain.Sticker): по width/height клиент вписывает стикер
// в бокс по пропорции, по mime заранее знает рендерер, thumb (base64 JPEG, как
// blur_preview у медиа) показывает нижним слоем, пока файл летит. path_thumb
// (векторный контур photoPathSize) отдаём во ВСЕХ ручках, а не только в наборе:
// одна и та же карточка стикера у клиента приходит то из набора, то из Recent/
// Faved/поиска и складывается в общий кэш по media_id — расхождение по составу
// полей между источниками там неуместно. Байтовый оверхед по размеру мал даже
// там, где список короткий (Recent — 20 записей, Faved — ~10), а там, где список
// большой (набор до 120 стикеров, до +50 КБ base64), силуэт нужнее всего — это
// холодный первый показ набора целиком.
func stickersJSON(sts []domain.Sticker) []map[string]any {
	out := make([]map[string]any, 0, len(sts))
	for _, s := range sts {
		out = append(out, map[string]any{
			"id": s.ID, "set_id": s.SetID, "media_id": s.MediaID, "emoji": s.Emoji,
			"width": s.Width, "height": s.Height, "mime": s.Mime, "thumb": s.Thumb,
			"path_thumb": s.PathThumb,
		})
	}
	return out
}

// MySets — GET /sticker-sets: установленные наборы пользователя.
func (h *StickersHandler) MySets(w http.ResponseWriter, r *http.Request) {
	sets, err := h.svc.MySets(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load sets")
		return
	}
	if sets == nil {
		sets = []domain.StickerSet{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sets": sets})
}

// SetBySlug — GET /sticker-sets/{slug}: набор со стикерами.
func (h *StickersHandler) SetBySlug(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	set, sts, err := h.svc.SetBySlug(r.Context(), slug)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "set not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load set")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"set": set, "stickers": stickersJSON(sts)})
}

// SetByMediaID — GET /stickers/by-media/{mediaID}: набор, которому принадлежит
// файл стикера. Нужен клику по стикеру в чате (tweb wrapSticker →
// showStickersPopup): сообщение несёт только media_id.
func (h *StickersHandler) SetByMediaID(w http.ResponseWriter, r *http.Request) {
	mediaID, ok := pathInt(w, r, "mediaID")
	if !ok {
		return
	}
	set, err := h.svc.SetByMediaID(r.Context(), mediaID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "media has no set")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load set")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"set": set})
}

// Install — POST /sticker-sets/{id}/install.
func (h *StickersHandler) Install(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	err := h.svc.Install(r.Context(), h.meID(r), id)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "set not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not install set")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Uninstall — DELETE /sticker-sets/{id}/install.
func (h *StickersHandler) Uninstall(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	if err := h.svc.Uninstall(r.Context(), h.meID(r), id); err != nil {
		writeError(w, http.StatusInternalServerError, "could not uninstall set")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SearchSets — GET /sticker-sets/search?q=.
func (h *StickersHandler) SearchSets(w http.ResponseWriter, r *http.Request) {
	sets, err := h.svc.SearchSets(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	if sets == nil {
		sets = []domain.StickerSet{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sets": sets})
}

// Featured — GET /sticker-sets/featured: трендовые наборы (новые первыми) —
// экран поиска стикеров показывает их при пустом запросе (tweb getFeaturedStickers).
func (h *StickersHandler) Featured(w http.ResponseWriter, r *http.Request) {
	sets, err := h.svc.Featured(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load featured")
		return
	}
	if sets == nil {
		sets = []domain.StickerSet{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sets": sets})
}

// CreateSet — POST /sticker-sets {slug,title,kind}.
func (h *StickersHandler) CreateSet(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Slug  string `json:"slug"`
		Title string `json:"title"`
		Kind  string `json:"kind"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	set, err := h.svc.CreateSet(r.Context(), h.meID(r), b.Slug, b.Title, b.Kind)
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid slug, title or kind")
		return
	}
	if errors.Is(err, domain.ErrConflict) {
		writeError(w, http.StatusConflict, "slug already taken")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create set")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"set": set})
}

// AddSticker — POST /sticker-sets/{id}/stickers {media_id,emoji}.
func (h *StickersHandler) AddSticker(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	var b struct {
		MediaID int64  `json:"media_id"`
		Emoji   string `json:"emoji"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.MediaID <= 0 {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	s, err := h.svc.AddSticker(r.Context(), h.meID(r), id, b.MediaID, b.Emoji)
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid emoji")
		return
	}
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not your set")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "set or media not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not add sticker")
		return
	}
	// Тем же представлением, что и выборки набора: добавленный стикер клиент
	// показывает сразу, метаданные файла ему нужны те же.
	writeJSON(w, http.StatusOK, map[string]any{"sticker": stickersJSON([]domain.Sticker{s})[0]})
}

// Recent — GET /stickers/recent.
func (h *StickersHandler) Recent(w http.ResponseWriter, r *http.Request) {
	sts, err := h.svc.Recent(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load recent")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stickers": stickersJSON(sts)})
}

// ClearRecent — DELETE /stickers/recent: очистить список недавних.
func (h *StickersHandler) ClearRecent(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.ClearRecent(r.Context(), h.meID(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "could not clear recent")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Faved — GET /stickers/faved.
func (h *StickersHandler) Faved(w http.ResponseWriter, r *http.Request) {
	sts, err := h.svc.Faved(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load faved")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stickers": stickersJSON(sts)})
}

// Fave — POST /stickers/{id}/fave.
func (h *StickersHandler) Fave(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	err := h.svc.Fave(r.Context(), h.meID(r), id)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "sticker not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fave")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Unfave — DELETE /stickers/{id}/fave.
func (h *StickersHandler) Unfave(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	if err := h.svc.Unfave(r.Context(), h.meID(r), id); err != nil {
		writeError(w, http.StatusInternalServerError, "could not unfave")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Use — POST /stickers/{id}/use: отметить использование (recent).
func (h *StickersHandler) Use(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "id")
	if !ok {
		return
	}
	err := h.svc.Use(r.Context(), h.meID(r), id)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "sticker not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not record use")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SearchByEmoji — GET /stickers/search?emoji=.
func (h *StickersHandler) SearchByEmoji(w http.ResponseWriter, r *http.Request) {
	sts, err := h.svc.SearchByEmoji(r.Context(), h.meID(r), r.URL.Query().Get("emoji"))
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "emoji is required")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stickers": stickersJSON(sts)})
}

// SavedGifs — GET /gifs/saved.
func (h *StickersHandler) SavedGifs(w http.ResponseWriter, r *http.Request) {
	gifs, err := h.svc.SavedGifs(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load gifs")
		return
	}
	if gifs == nil {
		gifs = []domain.SavedGif{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"gifs": gifs})
}

// SaveGif — POST /gifs/saved {media_id}.
func (h *StickersHandler) SaveGif(w http.ResponseWriter, r *http.Request) {
	var b struct {
		MediaID int64 `json:"media_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.MediaID <= 0 {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.svc.SaveGif(r.Context(), h.meID(r), b.MediaID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save gif")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteGif — DELETE /gifs/saved/{mediaID}.
func (h *StickersHandler) DeleteGif(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "mediaID")
	if !ok {
		return
	}
	if err := h.svc.DeleteGif(r.Context(), h.meID(r), id); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete gif")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SearchGifs — GET /gifs/search?q=&pos=: прокси внешнего поиска (Tenor).
// Без настроенного провайдера — 200 с пустой страницей.
func (h *StickersHandler) SearchGifs(w http.ResponseWriter, r *http.Request) {
	page, err := h.svc.SearchGifs(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("pos"))
	if err != nil {
		writeError(w, http.StatusBadGateway, "gif search failed")
		return
	}
	writeJSON(w, http.StatusOK, page)
}
