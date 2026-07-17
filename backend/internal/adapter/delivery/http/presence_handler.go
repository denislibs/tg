package http

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// PrivacyQuery — read-model-шов конфиденциальности для HTTP-хендлеров
// (аналог PresenceQuery): батч-ответ «viewer видит аспект key владельцев?».
// Реализуется usecase/privacy.Interactor.
type PrivacyQuery interface {
	VisibleMap(ctx context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error)
}

// PresenceHandler serves a batch snapshot of users' online / last-seen state, so
// the client can show "online" / "last seen ..." immediately on open and then
// keep it live via rt:presence events.
type PresenceHandler struct {
	presence PresenceQuery
	privacy  PrivacyQuery
}

func NewPresenceHandler(p PresenceQuery, privacy PrivacyQuery) *PresenceHandler {
	return &PresenceHandler{presence: p, privacy: privacy}
}

// Get handles GET /presence?ids=1,2,3. When presence is unavailable (no Redis)
// everyone is reported offline with last_seen 0. Пользователи, скрывшие время
// захода от запрашивающего (правило last_seen / блокировка), отдаются как
// offline/0 — клиент показывает «был(а) недавно».
func (h *PresenceHandler) Get(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var ids []int64
	for _, s := range strings.Split(r.URL.Query().Get("ids"), ",") {
		if s == "" {
			continue
		}
		if id, err := strconv.ParseInt(s, 10, 64); err == nil {
			ids = append(ids, id)
		}
	}
	visible := map[int64]bool{}
	if h.privacy != nil && len(ids) > 0 {
		if v, err := h.privacy.VisibleMap(r.Context(), user.ID, ids, domain.PrivacyLastSeen); err == nil {
			visible = v
		}
	}
	out := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		online, lastSeen := false, int64(0)
		allowed := true
		if h.privacy != nil {
			allowed = visible[id] || id == user.ID
		}
		if h.presence != nil && allowed {
			online, lastSeen = h.presence.Snapshot(r.Context(), id)
		}
		out = append(out, map[string]any{"user_id": id, "online": online, "last_seen": lastSeen})
	}
	writeJSON(w, http.StatusOK, map[string]any{"presence": out})
}
