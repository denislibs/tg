package http

import (
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

// GetWebPage — GET /webpage?url= — messages.getWebPage{url, hash}: карточка
// ссылки для плашки превью над полем ввода, до отправки (tweb
// components/chat/input.ts:3594 → appWebPagesManager.getWebPage :273-284).
// Ответ — messages.webPage; карточки нет — webPageEmpty с адресом (плашку
// tweb тогда не показывает, input.ts:3600). hash не принимаем: кэширует клиент
// (tweb invokeApiHashable), и ответ у нас всегда полный.
func (h *ChatHandler) GetWebPage(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	if url == "" {
		writeError(w, http.StatusBadRequest, "url required")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewMessagesWebPage(url, h.svc.GetWebPage(r.Context(), url)))
}
