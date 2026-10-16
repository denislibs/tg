package http

import (
	"net/http"
	"strconv"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// HelpHandler — конфиг приложения: `help.getAppConfig` и `help.getConfig`.
//
// Ручки за Bearer, как остальные ручки пользователя: tweb зовёт их уже внутри
// сессии (`apiManagerMethods.ts:310-366`). Состояния у них нет — значения берутся
// из domain/limits.go и флага DEV_PURCHASES, поэтому хэндлер без usecase.
type HelpHandler struct {
	// appConfig собран один раз: значения неизменны всю жизнь процесса (лимиты —
	// константы, флаги покупок — DEV_PURCHASES: dev-начисление звёзд и мок Premium
	// смонтированы, покупки не заблокированы).
	appConfig domain.HelpAppConfig
}

func NewHelpHandler(devPurchases bool) *HelpHandler {
	return &HelpHandler{appConfig: domain.NewHelpAppConfig(domain.NewAppConfig(devPurchases))}
}

// AppConfig — `help.getAppConfig{hash}` → `help.appConfig` | `help.appConfigNotModified`.
//
// `hash` — параметр запроса. Не число или отсутствует — это «конфига у клиента
// нет» (как `hash: 0` у tweb, `apiManagerMethods.ts:351`): отдаётся полный конфиг;
// отказа нет, потому что ошибаться тут нечем.
func (h *HelpHandler) AppConfig(w http.ResponseWriter, r *http.Request) {
	if got, err := strconv.ParseInt(r.URL.Query().Get("hash"), 10, 32); err == nil && int32(got) == h.appConfig.Hash {
		writeJSON(w, http.StatusOK, domain.NewHelpAppConfigNotModified())
		return
	}
	writeJSON(w, http.StatusOK, h.appConfig)
}

// Config — `help.getConfig` → `config`.
func (h *HelpHandler) Config(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, domain.NewConfig(time.Now().Unix()))
}
