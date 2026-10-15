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
	// devPurchases — DEV_PURCHASES: dev-начисление звёзд и мок Premium
	// смонтированы, покупки не заблокированы (appConfig `*_purchase_blocked`).
	devPurchases bool
}

func NewHelpHandler(devPurchases bool) *HelpHandler {
	return &HelpHandler{devPurchases: devPurchases}
}

// AppConfig — `help.getAppConfig{hash}` → `help.appConfig` | `help.appConfigNotModified`.
//
// `hash` — параметр запроса. Не число или отсутствует — это «конфига у клиента
// нет» (как `hash: 0` у tweb, `apiManagerMethods.ts:351`): отдаётся полный конфиг;
// отказа нет, потому что ошибаться тут нечем.
func (h *HelpHandler) AppConfig(w http.ResponseWriter, r *http.Request) {
	cfg := domain.NewHelpAppConfig(domain.NewAppConfig(h.devPurchases))
	if got, err := strconv.ParseInt(r.URL.Query().Get("hash"), 10, 32); err == nil && int32(got) == cfg.Hash {
		writeJSON(w, http.StatusOK, domain.NewHelpAppConfigNotModified())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// Config — `help.getConfig` → `config`.
func (h *HelpHandler) Config(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, domain.NewConfig(time.Now().Unix()))
}
