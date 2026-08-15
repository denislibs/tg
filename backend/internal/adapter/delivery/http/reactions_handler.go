package http

import (
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecasereactions "github.com/messenger-denis/backend/internal/usecase/reactions"
)

// ReactionsHandler — HTTP для каталога доступных реакций (Telegram
// messages.getAvailableReactions): без интерактора между хендлером и портом,
// т.к. это чистое чтение справочника без бизнес-логики и без привязки к
// пользователю (см. usecase/reactions/ports.go).
type ReactionsHandler struct{ repo usecasereactions.CatalogRepo }

func NewReactionsHandler(repo usecasereactions.CatalogRepo) *ReactionsHandler {
	return &ReactionsHandler{repo: repo}
}

// List — GET /reactions: полный каталог, одинаковый для всех пользователей
// (наборы стикеров тоже публичны — см. StickersHandler.Featured).
func (h *ReactionsHandler) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.repo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load reactions")
		return
	}
	if list == nil {
		list = []domain.AvailableReaction{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"reactions": list})
}
