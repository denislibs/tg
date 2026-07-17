package http

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasepasskeys "github.com/messenger-denis/backend/internal/usecase/passkeys"
)

// PasskeyHandler — ключи доступа (WebAuthn): регистрация/список/удаление
// (авторизованные /me/passkeys*) и вход без пароля по discoverable credential
// (публичные /auth/passkey/*). Challenge-сессии между begin/finish живут
// in-memory с TTL (одноинстансный бэкенд).
type PasskeyHandler struct {
	wa     *webauthn.WebAuthn
	uc     *usecasepasskeys.Interactor
	authUC *usecaseauth.Interactor

	mu       sync.Mutex
	sessions map[string]waSession
}

type waSession struct {
	data    *webauthn.SessionData
	expires time.Time
}

const waSessionTTL = 2 * time.Minute

func NewPasskeyHandler(rpID string, origins []string, uc *usecasepasskeys.Interactor, authUC *usecaseauth.Interactor) (*PasskeyHandler, error) {
	wa, err := webauthn.New(&webauthn.Config{
		RPDisplayName: "Messenger",
		RPID:          rpID,
		RPOrigins:     origins,
	})
	if err != nil {
		return nil, err
	}
	return &PasskeyHandler{wa: wa, uc: uc, authUC: authUC, sessions: map[string]waSession{}}, nil
}

func (h *PasskeyHandler) putSession(data *webauthn.SessionData) string {
	token, _, _ := domain.GenerateToken()
	h.mu.Lock()
	defer h.mu.Unlock()
	for k, s := range h.sessions { // мимоходом чистим истёкшие
		if time.Now().After(s.expires) {
			delete(h.sessions, k)
		}
	}
	h.sessions[token] = waSession{data: data, expires: time.Now().Add(waSessionTTL)}
	return token
}

func (h *PasskeyHandler) takeSession(token string) *webauthn.SessionData {
	h.mu.Lock()
	defer h.mu.Unlock()
	s, ok := h.sessions[token]
	delete(h.sessions, token)
	if !ok || time.Now().After(s.expires) {
		return nil
	}
	return s.data
}

// waUser адаптирует domain.User к webauthn.User; ID — десятичная строка.
type waUser struct {
	id          int64
	name        string
	credentials []webauthn.Credential
}

func (u waUser) WebAuthnID() []byte                         { return []byte(strconv.FormatInt(u.id, 10)) }
func (u waUser) WebAuthnName() string                       { return u.name }
func (u waUser) WebAuthnDisplayName() string                { return u.name }
func (u waUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

func (h *PasskeyHandler) userCredentials(r *http.Request, userID int64) []webauthn.Credential {
	list, err := h.uc.List(r.Context(), userID)
	if err != nil {
		return nil
	}
	creds := make([]webauthn.Credential, 0, len(list))
	for _, pk := range list {
		var c webauthn.Credential
		if json.Unmarshal(pk.Credential, &c) == nil {
			creds = append(creds, c)
		}
	}
	return creds
}

// BeginRegistration — POST /me/passkeys/begin → {session, options}.
func (h *PasskeyHandler) BeginRegistration(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	name := user.DisplayName
	if name == "" {
		name = user.Phone
	}
	wu := waUser{id: user.ID, name: name, credentials: h.userCredentials(r, user.ID)}
	// Discoverable (resident) key — вход без ввода телефона (tweb passkeys).
	options, session, err := h.wa.BeginRegistration(wu,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithExclusions(webauthn.Credentials(wu.credentials).CredentialDescriptors()),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "webauthn begin failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": h.putSession(session), "options": options})
}

// FinishRegistration — POST /me/passkeys/finish?session=... (тело — attestation).
func (h *PasskeyHandler) FinishRegistration(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	session := h.takeSession(r.URL.Query().Get("session"))
	if session == nil {
		writeError(w, http.StatusBadRequest, "session expired")
		return
	}
	name := user.DisplayName
	if name == "" {
		name = user.Phone
	}
	wu := waUser{id: user.ID, name: name, credentials: h.userCredentials(r, user.ID)}
	cred, err := h.wa.FinishRegistration(wu, *session, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "attestation invalid")
		return
	}
	raw, err := json.Marshal(cred)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	// Имя ключа — браузер/ОС создавшего устройства (tweb показывает модель).
	browser, osName := parseUserAgent(r.UserAgent())
	pkName := browser
	if osName != "" {
		if pkName != "" {
			pkName += " · " + osName
		} else {
			pkName = osName
		}
	}
	pk, err := h.uc.Add(r.Context(), domain.Passkey{
		UserID: user.ID, Name: pkName,
		CredID:     base64.RawURLEncoding.EncodeToString(cred.ID),
		Credential: raw,
	})
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "passkey limit reached")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, passkeyJSON(pk))
}

func passkeyJSON(pk domain.Passkey) map[string]any {
	return map[string]any{
		"id": pk.ID, "name": pk.Name, "created_at": pk.CreatedAt, "last_used_at": pk.LastUsedAt,
	}
}

// List — GET /me/passkeys.
func (h *PasskeyHandler) List(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	list, err := h.uc.List(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, pk := range list {
		out = append(out, passkeyJSON(pk))
	}
	writeJSON(w, http.StatusOK, map[string]any{"passkeys": out})
}

// Delete — DELETE /me/passkeys/{id}.
func (h *PasskeyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "passkeyID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := h.uc.Delete(r.Context(), user.ID, id); errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// BeginLogin — POST /auth/passkey/begin (публичный) → {session, options}.
func (h *PasskeyHandler) BeginLogin(w http.ResponseWriter, r *http.Request) {
	options, session, err := h.wa.BeginDiscoverableLogin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "webauthn begin failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": h.putSession(session), "options": options})
}

// FinishLogin — POST /auth/passkey/finish?session=...&device=...&platform=...
// (тело — assertion) → {token, user}.
func (h *PasskeyHandler) FinishLogin(w http.ResponseWriter, r *http.Request) {
	session := h.takeSession(r.URL.Query().Get("session"))
	if session == nil {
		writeError(w, http.StatusBadRequest, "session expired")
		return
	}
	var matched domain.Passkey
	cred, err := h.wa.FinishDiscoverableLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
		pk, err := h.uc.ByCredID(r.Context(), base64.RawURLEncoding.EncodeToString(rawID))
		if err != nil {
			return nil, err
		}
		matched = pk
		var c webauthn.Credential
		if err := json.Unmarshal(pk.Credential, &c); err != nil {
			return nil, err
		}
		return waUser{id: pk.UserID, name: pk.Name, credentials: []webauthn.Credential{c}}, nil
	}, *session, r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "passkey login failed")
		return
	}
	// Обновить счётчик подписи + last_used_at (best-effort).
	if raw, err := json.Marshal(cred); err == nil {
		_ = h.uc.TouchCredential(r.Context(), matched.ID, raw)
	}
	ctx := usecaseauth.WithClientInfo(r.Context(), clientInfoFromRequest(r))
	res, err := h.authUC.MintPasskeySession(ctx, matched.UserID,
		r.URL.Query().Get("device"), r.URL.Query().Get("platform"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": res.Token, "user": userJSON(res.User)})
}
