package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

type suggestBirthdayBody struct {
	Birthday *domain.Birthday `json:"birthday"`
}

// SuggestBirthday — users.suggestBirthday: POST /users/{userID}/suggest_birthday,
// тело {birthday: birthday}. Кладёт служебку messageActionSuggestBirthday в
// личную переписку; ответ — само созданное сообщение, тем же конструктором,
// что и предложение фото (POST /contacts/{id}/suggest_photo).
func (h *ChatHandler) SuggestBirthday(w http.ResponseWriter, r *http.Request) {
	userID, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	var body suggestBirthdayBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Birthday == nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	msg, err := h.svc.SuggestBirthday(r.Context(), h.meID(r), userID, *body.Birthday)
	switch {
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_birthday")
		return
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "user_not_found")
		return
	case errors.Is(err, domain.ErrForbidden), errors.Is(err, domain.ErrPrivacy):
		writeError(w, http.StatusForbidden, "forbidden")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "suggest birthday failed")
		return
	}
	writeMessage(w, r, h.svc, msg)
}
