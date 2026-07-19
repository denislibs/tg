package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
)

// PrivacyHandler — раздел «Конфиденциальность»: правила «кто видит/может»
// (GET/PUT /me/privacy), чёрный список (/me/blocked) и чужой профиль с учётом
// privacy (GET /users/{userID}).
type PrivacyHandler struct{ uc *usecaseprivacy.Interactor }

func NewPrivacyHandler(uc *usecaseprivacy.Interactor) *PrivacyHandler { return &PrivacyHandler{uc: uc} }

func ruleJSON(r domain.PrivacyRule) map[string]any {
	allow, deny := r.AllowUserIDs, r.DenyUserIDs
	if allow == nil {
		allow = []int64{}
	}
	if deny == nil {
		deny = []int64{}
	}
	return map[string]any{"key": string(r.Key), "value": r.Value, "allow_user_ids": allow, "deny_user_ids": deny}
}

// Rules — GET /me/privacy: полный набор правил (с дефолтами).
func (h *PrivacyHandler) Rules(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	rules, err := h.uc.Rules(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(rules))
	for _, rule := range rules {
		out = append(out, ruleJSON(rule))
	}
	writeJSON(w, http.StatusOK, map[string]any{"rules": out})
}

// SetRule — PUT /me/privacy/{key}: правило одного ключа целиком.
func (h *PrivacyHandler) SetRule(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		Value        string  `json:"value"`
		AllowUserIDs []int64 `json:"allow_user_ids"`
		DenyUserIDs  []int64 `json:"deny_user_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	rule, err := h.uc.SetRule(r.Context(), user.ID, domain.PrivacyRule{
		Key:   domain.PrivacyKey(chi.URLParam(r, "key")),
		Value: b.Value, AllowUserIDs: b.AllowUserIDs, DenyUserIDs: b.DenyUserIDs,
	})
	if errors.Is(err, usecaseprivacy.ErrBadRule) {
		writeError(w, http.StatusBadRequest, "bad rule")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, ruleJSON(rule))
}

// Blocked — GET /me/blocked?offset=&limit=: страница чёрного списка.
func (h *PrivacyHandler) Blocked(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	users, total, err := h.uc.Blocked(r.Context(), user.ID, offset, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]any{
			"user_id": u.UserID, "username": u.Username, "display_name": u.DisplayName,
			"avatar_url": u.AvatarURL, "phone": u.Phone,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out, "total": total})
}

// Block — POST /me/blocked {user_id}.
func (h *PrivacyHandler) Block(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		UserID int64 `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.UserID <= 0 {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	err := h.uc.Block(r.Context(), user.ID, b.UserID)
	if errors.Is(err, usecaseprivacy.ErrSelfBlock) {
		writeError(w, http.StatusBadRequest, "self block")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Unblock — DELETE /me/blocked/{userID}.
func (h *PrivacyHandler) Unblock(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "userID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad user id")
		return
	}
	if err := h.uc.Unblock(r.Context(), user.ID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Profile — GET /users/{userID}: чужой профиль после применения privacy.
func (h *PrivacyHandler) Profile(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "userID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad user id")
		return
	}
	p, err := h.uc.Profile(r.Context(), user.ID, id)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	var username any
	if p.Username != nil {
		username = *p.Username
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": p.ID, "username": username,
		"first_name": p.FirstName, "last_name": p.LastName, "display_name": p.DisplayName,
		"bio": p.Bio, "birthday": p.Birthday, "avatar_url": p.AvatarURL, "phone": p.Phone,
		"verified": p.Verified, "is_bot": p.IsBot, "is_blocked": p.IsBlocked,
		"calls_available": p.CallsAvailable, "can_message": p.CanMessage,
		"last_seen_visible": p.LastSeenOK,
	})
}
