package http

import (
	"net/http"
	"strconv"
	"strings"
)

// PresenceHandler serves a batch snapshot of users' online / last-seen state, so
// the client can show "online" / "last seen ..." immediately on open and then
// keep it live via rt:presence events.
type PresenceHandler struct{ presence PresenceQuery }

func NewPresenceHandler(p PresenceQuery) *PresenceHandler { return &PresenceHandler{presence: p} }

// Get handles GET /presence?ids=1,2,3. When presence is unavailable (no Redis)
// everyone is reported offline with last_seen 0.
func (h *PresenceHandler) Get(w http.ResponseWriter, r *http.Request) {
	out := make([]map[string]any, 0)
	for _, s := range strings.Split(r.URL.Query().Get("ids"), ",") {
		if s == "" {
			continue
		}
		id, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			continue
		}
		online, lastSeen := false, int64(0)
		if h.presence != nil {
			online, lastSeen = h.presence.Snapshot(r.Context(), id)
		}
		out = append(out, map[string]any{"user_id": id, "online": online, "last_seen": lastSeen})
	}
	writeJSON(w, http.StatusOK, map[string]any{"presence": out})
}
