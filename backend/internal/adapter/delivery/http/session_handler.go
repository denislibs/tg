package http

import (
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

type SessionHandler struct{ svc *usecaseauth.Interactor }

func NewSessionHandler(svc *usecaseauth.Interactor) *SessionHandler { return &SessionHandler{svc: svc} }

func (h *SessionHandler) List(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	// Id устройства проверяется, а не глотается. Без него НИ ОДНА строка не
	// получит флага `current`: вкладка «Устройства» не найдёт своей сессии и
	// умрёт на пустом месте, показав пользователю пустоту вместо списка. Отдать
	// такой список — значит соврать («текущей сессии нет»), поэтому это отказ.
	//
	// Ноль проверяется наравне с отсутствием ключа: канальный RPC пред-инжектит
	// пару юзер+устройство целиком (`rpc.go:22` → `WithUser`), и незаполненный
	// id приезжает сюда как ноль при `ok == true`.
	current, ok := DeviceIDFromContext(r.Context())
	if !ok || current == 0 {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	devices, err := h.svc.ListSessions(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list sessions")
		return
	}
	// «Текущая» — ФЛАГ конструктора, а не булево поле рядом: прежде ехало
	// `current: false`, то есть «выключено» имело значение. Ноль вместо адреса
	// у текущей строки ставит сам конструктор — см. докблок Authorization.
	out := make([]domain.Authorization, 0, len(devices))
	for _, d := range devices {
		out = append(out, domain.NewAuthorization(d, d.ID == current))
	}
	writeJSON(w, http.StatusOK, domain.NewAccountAuthorizations(out))
}

// RevokeOthers terminates every session except the current one.
func (h *SessionHandler) RevokeOthers(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	current, ok := DeviceIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	// «Все прочие» знает, кто текущий, из КОНТЕКСТА запроса, а не из адреса в
	// теле: обнуление hash у текущей строки витрины этот путь не задевает.
	n, err := h.svc.RevokeOtherSessions(r.Context(), user.ID, current)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke sessions")
		return
	}
	// Ответ — «получилось». Число отозванных не читал никто: экран показывает
	// список сессий, а он перезапрашивается.
	_ = n
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *SessionHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	deviceID, ok := pathInt(w, r, "deviceID")
	if !ok {
		return
	}
	// Ноль сюда приехать не может: это адрес ТЕКУЩЕЙ сессии, а её не отзывают —
	// из неё выходят (POST /auth/logout). Клиент такой строки и не отдаёт, но
	// отказ здесь явный: иначе ноль ушёл бы в запрос как обычный id и молча
	// вернул «сессия не найдена», спрятав ошибку вызывающего.
	if deviceID == 0 {
		writeError(w, http.StatusBadRequest, "current session is not revocable by hash")
		return
	}
	revoked, err := h.svc.RevokeSession(r.Context(), user.ID, deviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke session")
		return
	}
	if !revoked {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *SessionHandler) Logout(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	deviceID, ok := DeviceIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	if _, err := h.svc.RevokeSession(r.Context(), user.ID, deviceID); err != nil {
		writeError(w, http.StatusInternalServerError, "logout failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
