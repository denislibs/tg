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

// coveredSets — наборы с превью как вектор `StickerSetCovered` схемы: строка
// выдачи (тренды, поиск) показывает первые стикеры набора, не дожидаясь
// отдельного запроса за полным составом.
//
// Конструктор — `stickerSetFullCovered` (набор + документы + обратный индекс),
// а не `stickerSetCovered` с ОДНОЙ обложкой: у нас превью несколько, и
// одноообложечный вариант выбросил бы остальные. Порядок наборов — тот, в
// котором их отдал usecase: на проводе позиция вектора и есть порядок (Р8).
func coveredSets(sets []domain.StickerSetRecord, covers map[int64][]domain.Sticker) []domain.StickerSetCovered {
	out := make([]domain.StickerSetCovered, 0, len(sets))
	for _, set := range sets {
		sts := covers[set.ID]
		out = append(out, domain.StickerSetFullCovered{
			Underscore: domain.StickerSetFullCoveredTag,
			Set:        domain.StickerSetWire(set),
			Packs:      domain.StickerPacks(sts),
			Keywords:   []domain.StickerKeyword{},
			Documents:  domain.StickerDocuments(sts),
		})
	}
	return out
}

// MySets — GET /sticker-sets: установленные наборы пользователя
// (messages.allStickers схемы).
func (h *StickersHandler) MySets(w http.ResponseWriter, r *http.Request) {
	sets, err := h.svc.MySets(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load sets")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesAllStickers(domain.StickerSetsWire(sets)))
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
	writeJSON(w, http.StatusOK, domain.NewMessagesStickerSet(
		domain.StickerSetWire(set), domain.StickerPacks(sts), domain.StickerDocuments(sts)))
}

// SetByID — GET /sticker-sets/id/{setID}: тот же набор со стикерами, что и
// SetBySlug, но адресованный ЧИСЛОМ.
//
// Два маршрута на один ответ — не дубль, а два конструктора одного объединения:
// у оригинала метод `messages.getStickerSet` один и принимает `InputStickerSet`
// (`inputStickerSetShortName` либо `inputStickerSetID`). У REST адрес живёт в
// пути, поэтому конструктору соответствует маршрут; на фазе 3, когда тело
// станет TL, эти два схлопнутся в один метод с объединением в параметре.
//
// Нужен он ровно с того момента, как документ понёс `stickerset` (Р3): клик по
// стикеру в чате знает ЧИСЛО набора, а не его короткое имя, — и раньше ради
// перевода одного в другое ходил в сеть за обратным поиском.
func (h *StickersHandler) SetByID(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "setID")
	if !ok {
		return
	}
	set, sts, err := h.svc.SetByID(r.Context(), id)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "set not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load set")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesStickerSet(
		domain.StickerSetWire(set), domain.StickerPacks(sts), domain.StickerDocuments(sts)))
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

// SearchSets — GET /sticker-sets/search?q= (messages.foundStickerSets схемы).
func (h *StickersHandler) SearchSets(w http.ResponseWriter, r *http.Request) {
	sets, covers, err := h.svc.SearchSets(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesFoundStickerSets(coveredSets(sets, covers)))
}

// Featured — GET /sticker-sets/featured: трендовые наборы (новые первыми) —
// экран поиска стикеров показывает их при пустом запросе (tweb getFeaturedStickers).
// Вместе с наборами едут превью (covered sets, tweb messages.getFeaturedStickers):
// первые стикеры каждого набора одним запросом, чтобы строка не была пустой до
// отдельного похода за полным набором.
func (h *StickersHandler) Featured(w http.ResponseWriter, r *http.Request) {
	sets, covers, err := h.svc.Featured(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load featured")
		return
	}
	// `count` — сколько наборов в выдаче. Отдельного «всего в каталоге» у нас
	// нет: потолок featuredLim выше полного каталога, поэтому выдача и есть всё.
	writeJSON(w, http.StatusOK, domain.NewMessagesFeaturedStickers(len(sets), coveredSets(sets, covers)))
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
	writeJSON(w, http.StatusOK, domain.NewMessagesStickerSet(
		domain.StickerSetWire(set), []domain.StickerPack{}, nil))
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
	// Тем же конструктором, что и выборки набора: добавленный стикер клиент
	// показывает сразу, и это ТОТ ЖЕ документ, что приедет при следующей
	// загрузке набора.
	writeJSON(w, http.StatusOK, map[string]any{"document": domain.StickerDocument(s)})
}

// Recent — GET /stickers/recent.
func (h *StickersHandler) Recent(w http.ResponseWriter, r *http.Request) {
	sts, err := h.svc.Recent(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load recent")
		return
	}
	docs, dates := domain.RecentDocuments(sts)
	writeJSON(w, http.StatusOK, domain.NewMessagesRecentStickers(docs, dates))
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
	writeJSON(w, http.StatusOK, domain.NewMessagesFavedStickers(
		domain.StickerDocuments(sts), domain.StickerPacks(sts)))
}

// Fave — POST /stickers/{docID}/fave.
//
// Сегмент — id ДОКУМЕНТА (document.id схемы), а не строки набора: у оригинала
// messages.faveSticker принимает InputDocument. Суррогатный ключ строки наружу
// больше не выходит (Р2), поэтому и имя сегмента другое — иначе клиент
// продолжил бы слать в него старое число, и промах был бы молчаливым.
func (h *StickersHandler) Fave(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "docID")
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

// Unfave — DELETE /stickers/{docID}/fave.
func (h *StickersHandler) Unfave(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "docID")
	if !ok {
		return
	}
	if err := h.svc.Unfave(r.Context(), h.meID(r), id); err != nil {
		writeError(w, http.StatusInternalServerError, "could not unfave")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Use — POST /stickers/{docID}/use: отметить использование (recent).
func (h *StickersHandler) Use(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "docID")
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
	writeJSON(w, http.StatusOK, domain.NewMessagesStickers(domain.StickerDocuments(sts)))
}

// SavedGifs — GET /gifs/saved.
func (h *StickersHandler) SavedGifs(w http.ResponseWriter, r *http.Request) {
	gifs, err := h.svc.SavedGifs(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load gifs")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesSavedGifs(domain.GifDocuments(gifs)))
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
