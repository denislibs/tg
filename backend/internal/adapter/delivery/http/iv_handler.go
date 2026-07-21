package http

import (
	"errors"
	"net/http"

	usecaseiv "github.com/messenger-denis/backend/internal/usecase/iv"
)

// IVHandler — Instant View: GET /iv?url=… отдаёт reader-mode статью
// типизированными блоками (без HTML).
type IVHandler struct{ uc *usecaseiv.Interactor }

func NewIVHandler(uc *usecaseiv.Interactor) *IVHandler { return &IVHandler{uc: uc} }

func (h *IVHandler) Article(w http.ResponseWriter, r *http.Request) {
	art, err := h.uc.Article(r.Context(), r.URL.Query().Get("url"))
	switch {
	case errors.Is(err, usecaseiv.ErrBadURL):
		writeError(w, http.StatusBadRequest, "invalid url")
	case errors.Is(err, usecaseiv.ErrUnparsable):
		writeError(w, http.StatusUnprocessableEntity, "article not parsable")
	case err != nil:
		writeError(w, http.StatusBadGateway, "fetch failed")
	default:
		writeJSON(w, http.StatusOK, art)
	}
}
