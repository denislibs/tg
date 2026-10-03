package http

import (
	"net/http"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	usecasestats "github.com/messenger-denis/backend/internal/usecase/stats"
)

// StatsHandler — статистика каналов, групп и постов в форме схемы
// (stats.broadcastStats / stats.megagroupStats / stats.messageStats).
// peers — слой разрешения адресов: peerId ↔ chatID (в URL едет знаковый ключ
// пира) и номер сообщения ↔ messages.id (в URL едет номер в чате).
type StatsHandler struct {
	uc    *usecasestats.Interactor
	peers statsResolver
}

// statsResolver — оба слоя разрешения, нужные этому хендлеру.
type statsResolver interface {
	PeerResolver
	MessageResolver
}

// NewStatsHandler создаёт хендлер статистики.
func NewStatsHandler(uc *usecasestats.Interactor, peers statsResolver) *StatsHandler {
	return &StatsHandler{uc: uc, peers: peers}
}

// ChannelStats — GET /channels/{chatID}/stats. Доступ только у создателя/админа
// (иначе 403). Канал отвечает stats.broadcastStats (stats.getBroadcastStats),
// группа — stats.megagroupStats (stats.getMegagroupStats).
func (h *StatsHandler) ChannelStats(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.peers)
	if !ok {
		return
	}
	st, err := h.uc.ChannelStats(r.Context(), chatID, user.ID)
	switch {
	case err == nil:
	case err == domain.ErrForbidden:
		writeError(w, http.StatusForbidden, "forbidden")
		return
	case err == domain.ErrNotFound:
		writeError(w, http.StatusNotFound, "not found")
		return
	default:
		writeError(w, http.StatusInternalServerError, "server error")
		return
	}

	if st.Broadcast {
		writeJSON(w, http.StatusOK, st.ToBroadcastWire(time.Now()))
		return
	}
	writeJSON(w, http.StatusOK, st.ToMegagroupWire(time.Now()))
}

// PostStats — GET /chats/{chatID}/messages/{msgID}/stats. Статистика одного
// поста — stats.messageStats (stats.getMessageStats). Доступ только у
// создателя/админа (иначе 403); нет поста — 404.
func (h *StatsHandler) PostStats(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := peerChatID(w, r, h.peers)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.peers, chatID)
	if !ok {
		return
	}
	st, err := h.uc.PostStats(r.Context(), chatID, msgID, user.ID)
	switch {
	case err == nil:
	case err == domain.ErrForbidden:
		writeError(w, http.StatusForbidden, "forbidden")
		return
	case err == domain.ErrNotFound:
		writeError(w, http.StatusNotFound, "not found")
		return
	default:
		writeError(w, http.StatusInternalServerError, "server error")
		return
	}

	writeJSON(w, http.StatusOK, st.ToWire(time.Now()))
}
