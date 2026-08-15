package http

import (
	"context"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

// availableReactionsRepo — порт каталога доступных реакций, которого хватает
// хендлеру (только чтение списка). Не путать с pgadapter.ReactionsRepo: тот
// хранит реакции пользователей на конкретных сообщениях, а этот — общий для
// всех справочник эмодзи-реакций (backend реализация — AvailableReactionsRepo).
type availableReactionsRepo interface {
	List(ctx context.Context) ([]domain.AvailableReaction, error)
}

// ReactionsHandler — HTTP для каталога доступных реакций (Telegram
// messages.getAvailableReactions): без usecase-слоя, т.к. это чистое чтение
// справочника без бизнес-логики и без привязки к пользователю.
type ReactionsHandler struct{ repo availableReactionsRepo }

func NewReactionsHandler(repo availableReactionsRepo) *ReactionsHandler {
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
