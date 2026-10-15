package http

import (
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

type SessionHandler struct{ svc *usecaseauth.Interactor }

func NewSessionHandler(svc *usecaseauth.Interactor) *SessionHandler { return &SessionHandler{svc: svc} }

// currentDeviceID — устройство, из которого пришёл запрос. Ручки сессий без
// него работать не могут, поэтому отсутствие — отказ, а не ноль по умолчанию.
//
// Ноль отвергается НАРАВНЕ с отсутствием ключа, и это не педантизм: пара
// юзер+устройство попадает в контекст не только из заголовка, но и пред-инжектом
// канального RPC (`rpc.go:22` → `WithUser`) и из кэша сессий
// (`usecase/auth.Authenticate` → `domain.Session`), поэтому незаполненное
// устройство приезжает как `(0, true)`, а не как отсутствие.
//
// Дальше ноль означает разное и всегда плохое:
//   - в списке сессий ни одна строка не получит флага `current` — вкладка не
//     найдёт своей сессии и покажет пустоту вместо списка;
//   - в «завершить все прочие» он превращается в `DELETE … WHERE id<>0`, то
//     есть в снос ВСЕХ сессий пользователя вместе с той, из которой нажали
//     кнопку.
//
// Поэтому проверка одна на все четыре ручки, а не по вкусу в каждой. Пятая
// ручка с тем же входом — `push_handler.go::Subscribe` — сюда пока не сведена
// (#111).
func currentDeviceID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, ok := DeviceIDFromContext(r.Context())
	if !ok || id == 0 {
		writeError(w, http.StatusUnauthorized, "no session")
		return 0, false
	}
	return id, true
}

func (h *SessionHandler) List(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	current, ok := currentDeviceID(w, r)
	if !ok {
		return
	}
	devices, err := h.svc.ListSessions(r.Context(), user.ID)
	if err != nil {
		writeDomainError(w, err, "could not list sessions")
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

// writeTerminateError — общие отказы завершения сессий.
//
// 406 FRESH_RESET_AUTHORISATION_FORBIDDEN: первые сутки сессия не завершает
// другие (tweb appAccountManager.ts:71-77). Код 406 tweb не определяет — вывод
// из клиента: текст отказа он разбирает по `error.type` (getAuthorizationErrorLangKey).
// ErrNoCurrentSession — строки ТЕКУЩЕЙ сессии уже нет, хотя кэш сессий ещё
// пропускает токен: тот же ответ, что у currentDeviceID. Прочий ErrNotFound
// (например, цели) сюда не попадает.
func writeTerminateError(w http.ResponseWriter, err error, msg string) {
	switch {
	case errors.Is(err, domain.ErrFreshAuthorization):
		writeError(w, http.StatusNotAcceptable, "FRESH_RESET_AUTHORISATION_FORBIDDEN")
	case errors.Is(err, domain.ErrNoCurrentSession):
		writeError(w, http.StatusUnauthorized, "no session")
	default:
		writeDomainError(w, err, msg)
	}
}

// RevokeOthers terminates every session except the current one.
func (h *SessionHandler) RevokeOthers(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	// «Все прочие» знает, кто текущий, из КОНТЕКСТА запроса, а не из адреса в
	// теле: обнуление hash у текущей строки витрины этот путь не задевает.
	current, ok := currentDeviceID(w, r)
	if !ok {
		return
	}
	n, err := h.svc.TerminateOtherSessions(r.Context(), user.ID, current)
	if err != nil {
		writeTerminateError(w, err, "could not revoke sessions")
		return
	}
	// Ответ — «получилось». Число отозванных не читал никто: экран показывает
	// список сессий, а он перезапрашивается.
	_ = n
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *SessionHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	current, ok := currentDeviceID(w, r)
	if !ok {
		return
	}
	deviceID, ok := pathInt(w, r, "deviceID")
	if !ok {
		return
	}
	revoked, err := h.svc.TerminateSession(r.Context(), user.ID, current, deviceID)
	if errors.Is(err, domain.ErrInvalid) {
		// Своя сессия (ноль или настоящий id) по этому пути не отзывается.
		writeError(w, http.StatusBadRequest, "current session is not revocable by hash")
		return
	}
	if err != nil {
		writeTerminateError(w, err, "could not revoke session")
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
	deviceID, ok := currentDeviceID(w, r)
	if !ok {
		return
	}
	if _, err := h.svc.RevokeSession(r.Context(), user.ID, deviceID); err != nil {
		writeDomainError(w, err, "logout failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
