package http

import (
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

// Догонка апдейтов — методы схемы updates.*, ровно те, что зовёт клиент tweb
// (apiUpdatesManager): getState при первом подключении, getDifference после
// каждого (пере)подключения и getChannelDifference по каналу.

// UpdatesState — GET /updates/state: updates.getState → updates.state.
func (h *ChatHandler) UpdatesState(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.UpdatesState(r.Context(), h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get state failed")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// UpdatesDifference — GET /updates/difference?pts=&date=&qts=:
// updates.getDifference → updates.difference / differenceSlice /
// differenceEmpty / differenceTooLong. qts не используется (секретных чатов в
// ящике qts у нас нет).
func (h *ChatHandler) UpdatesDifference(w http.ResponseWriter, r *http.Request) {
	d, err := h.svc.UpdatesDifference(r.Context(), h.meID(r), queryInt(r, "pts", 0), queryInt(r, "date", 0))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get difference failed")
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// UpdatesChannelDifference — GET /updates/channel_difference?channel=&pts=&limit=:
// updates.getChannelDifference → updates.channelDifference /
// channelDifferenceEmpty / channelDifferenceTooLong. channel — ключ пира
// канала (< 0). Читать может тот, кто читает канал: у публичного — и не
// участник (tweb опрашивает открытый чужой канал, subscribeToChannelUpdates).
func (h *ChatHandler) UpdatesChannelDifference(w http.ResponseWriter, r *http.Request) {
	peer := queryPeer(r, "channel", domain.NullPeerID)
	if peer >= 0 {
		writeError(w, http.StatusBadRequest, "invalid channel")
		return
	}
	chatID, ok := resolveBodyPeer(w, r, h.svc, peer, false)
	if !ok {
		return
	}
	d, err := h.svc.UpdatesChannelDifference(r.Context(), h.meID(r), chatID,
		queryInt(r, "pts", 0), int(queryInt(r, "limit", 0)))
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, d)
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid channel")
	default:
		writeError(w, http.StatusInternalServerError, "get channel difference failed")
	}
}
