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

// Report — POST /report {peer_id, id, reason, comment?}. id — ВЕКТОР номеров
// сообщений у этого пира (messages.report{id: Vector<int>}, tweb
// appMessagesManager.ts:7807-7827); пустой или отсутствующий — жалоба на чат
// целиком (reportAd.tsx:372). Номеров больше usecasereport.MaxIDs — 400
// «invalid report»; неизвестный номер — 404 «message not found». Причина — из
// белого списка usecase.
func (h *ReportHandler) Report(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		PeerID  domain.PeerID `json:"peer_id"`
		Seqs    []int64       `json:"id"`
		Reason  string        `json:"reason"`
		Comment string        `json:"comment"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if len(b.Seqs) > usecasereport.MaxIDs || !domain.ValidReportReason(domain.ReportReason(b.Reason)) {
		writeError(w, http.StatusBadRequest, "invalid report")
		return
	}
	chatID, ok := resolveBodyPeer(w, r, h.peers, b.PeerID, false)
	if !ok {
		return
	}
	var msgIDs []int64
	if len(b.Seqs) > 0 {
		bySeq, err := h.peers.MessageIDsBySeqs(r.Context(), chatID, b.Seqs)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "message lookup failed")
			return
		}
		msgIDs = make([]int64, 0, len(b.Seqs))
		for _, seq := range b.Seqs {
			id, found := bySeq[seq]
			if !found {
				writeError(w, http.StatusNotFound, "message not found")
				return
			}
			msgIDs = append(msgIDs, id)
		}
	}
	err := h.uc.Report(r.Context(), user.ID, chatID, msgIDs, domain.ReportReason(b.Reason), b.Comment)
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
