package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecasereport "github.com/messenger-denis/backend/internal/usecase/report"
)

// ReportHandler — жалобы на чат/сообщение (tweb reportMessages / reportPeer).
// peers — слой разрешения peerId ↔ chatID: жалоба адресует пир, а не строку chats.
type ReportHandler struct {
	uc    *usecasereport.Interactor
	peers PeerResolver
}

// NewReportHandler создаёт хендлер жалоб.
func NewReportHandler(uc *usecasereport.Interactor, peers PeerResolver) *ReportHandler {
	return &ReportHandler{uc: uc, peers: peers}
}

// Report — POST /report {peer_id, msg_id?, reason, comment?}. msg_id опционален
// (жалоба на чат целиком). Причина — из белого списка usecase.
func (h *ReportHandler) Report(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		PeerID  domain.PeerID `json:"peer_id"`
		MsgID   *int64        `json:"msg_id"`
		Reason  string        `json:"reason"`
		Comment string        `json:"comment"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	chatID, ok := resolveBodyPeer(w, r, h.peers, b.PeerID, false)
	if !ok {
		return
	}
	err := h.uc.Report(r.Context(), user.ID, chatID, b.MsgID, domain.ReportReason(b.Reason), b.Comment)
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid report")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "chat not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not submit report")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
