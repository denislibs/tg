package http

import "net/http"

func MeHandler(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":           u.ID,
		"phone":        u.Phone,
		"display_name": u.DisplayName,
	})
}
