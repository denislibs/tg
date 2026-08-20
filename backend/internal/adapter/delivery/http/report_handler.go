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
	peers reportResolver
}

// NewReportHandler создаёт хендлер жалоб.
func NewReportHandler(uc *usecasereport.Interactor, peers reportResolver) *ReportHandler {
	return &ReportHandler{uc: uc, peers: peers}
}

// reportResolver — оба слоя разрешения адресов, нужные жалобе.
type reportResolver interface {
	PeerResolver
	MessageResolver
}

// Report — POST /report {peer_id, id?, reason, comment?}. id опционален
// (жалоба на чат целиком) и означает НОМЕР сообщения у этого пира.
// Причина — из белого списка usecase.
func (h *ReportHandler) Report(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		PeerID  domain.PeerID `json:"peer_id"`
		Seq     *int64        `json:"id"`
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
	var msgID *int64
	if b.Seq != nil {
		id, ok := resolveMsgSeq(w, r, h.peers, chatID, *b.Seq)
		if !ok {
			return
		}
		msgID = &id
	}
	err := h.uc.Report(r.Context(), user.ID, chatID, msgID, domain.ReportReason(b.Reason), b.Comment)
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
