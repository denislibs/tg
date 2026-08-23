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

// ruleKey — ключ настройки из пути. На проводе он КОНСТРУКТОР схемы
// (`privacyKeyStatusTimestamp`), а не наша строка: путь называет ровно то, что
// у оригинала называет параметр метода `account.getPrivacy`.
func ruleKey(w http.ResponseWriter, r *http.Request) (domain.PrivacyKey, bool) {
	key, ok := domain.PrivacyKeyOf(chi.URLParam(r, "key"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown privacy key")
		return "", false
	}
	return key, true
}

// Rule — GET /me/privacy/{key}: правила ОДНОГО ключа.
//
// Ручки «все правила разом» больше нет, и это не упрощение интерфейса, а форма
// оригинала: `account.getPrivacy` спрашивает один ключ, а раздел настроек
// спрашивает их по очереди (privacyAndSecurity.tsx:574). Ключа в ответе нет —
// его знает спросивший.
func (h *PrivacyHandler) Rule(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	key, ok := ruleKey(w, r)
	if !ok {
		return
	}
	rule, err := h.uc.Rule(r.Context(), user.ID, key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewAccountPrivacyRules(domain.PrivacyRulesOf(rule), nil, nil))
}

// SetRule — PUT /me/privacy/{key}: правила одного ключа целиком.
//
// Тело — тот же ВЕКТОР правил, что и в ответе: у оригинала вход и выход одного
// метода описаны одним объединением (InputPrivacyRule против PrivacyRule
// отличается только формой ссылки на пира, которой у нас нет).
func (h *PrivacyHandler) SetRule(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	key, ok := ruleKey(w, r)
	if !ok {
		return
	}
	var b struct {
		Rules domain.PrivacyRuleUnion `json:"rules"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	rule, err := h.uc.SetRule(r.Context(), user.ID, domain.PrivacyRecordOf(key, b.Rules))
	if errors.Is(err, usecaseprivacy.ErrBadRule) {
		writeError(w, http.StatusBadRequest, "bad rule")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewAccountPrivacyRules(domain.PrivacyRulesOf(rule), nil, nil))
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
	// Раскладка contacts.blockedSlice: СТРОКИ блокировки (кто и когда) отдельно,
	// тела пиров — вектором users. Снимок профиля внутри строки блокировки был
	// бы второй формой того же `user`.
	blocked := make([]domain.PeerBlocked, 0, len(users))
	peers := make([]domain.UserReal, 0, len(users))
	for _, u := range users {
		blocked = append(blocked, u.Blocked)
		peers = append(peers, u.User)
	}
	writeJSON(w, http.StatusOK, domain.NewContactsBlockedSlice(total, blocked, peers))
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
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
	writeJSON(w, http.StatusOK, map[string]any{"user_full": p.Full, "can_message": p.CanMessage})
}
