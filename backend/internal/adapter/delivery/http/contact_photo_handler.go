package http

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasecontacts "github.com/messenger-denis/backend/internal/usecase/contacts"
)

// ContactPhotoHandler serves personal ("set photo for contact") and suggested
// ("suggest photo") profile-photo actions. Personal photos live in the contacts
// usecase (owner-only override); suggestions are service messages owned by the
// chat usecase.
type ContactPhotoHandler struct {
	contacts *usecasecontacts.Interactor
	chat     *usecasechat.Interactor
}

func NewContactPhotoHandler(contacts *usecasecontacts.Interactor, chat *usecasechat.Interactor) *ContactPhotoHandler {
	return &ContactPhotoHandler{contacts: contacts, chat: chat}
}

// SetCustomPhoto points the owner's personal photo for a contact at an uploaded
// media object (PUT /contacts/{userID}/photo). Body: {media_id}. Only the owner
// sees it; the contact is not notified.
func (h *ContactPhotoHandler) SetCustomPhoto(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	userID, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	var body avatarBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.MediaID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := h.contacts.SetCustomPhoto(r.Context(), u.ID, userID, body.MediaID)
	switch {
	case errors.Is(err, usecasecontacts.ErrSelfContact):
		writeError(w, http.StatusBadRequest, "cannot_set_self")
		return
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found")
		return
	case err != nil:
		log.Printf("[contacts] set custom photo user=%d contact=%d media=%d: %v", u.ID, userID, body.MediaID, err)
		writeError(w, http.StatusInternalServerError, "set contact photo failed")
		return
	}
	// Ответ — «получилось». Номер фото был ЭХОМ запроса: клиент прислал его
	// сам, и второй раз он ему не нужен.
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// ClearCustomPhoto removes the owner's personal photo for a contact
// (DELETE /contacts/{userID}/photo) — the contact's real avatar shows again.
func (h *ContactPhotoHandler) ClearCustomPhoto(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	userID, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	if err := h.contacts.ClearCustomPhoto(r.Context(), u.ID, userID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		writeError(w, http.StatusInternalServerError, "clear contact photo failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// SuggestPhoto suggests a new profile photo to a contact
// (POST /contacts/{userID}/suggest_photo). Body: {media_id}. Posts a service
// message into the private chat with a preview and an Accept button.
func (h *ContactPhotoHandler) SuggestPhoto(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	userID, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	var body avatarBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.MediaID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	msg, err := h.chat.SuggestProfilePhoto(r.Context(), u.ID, userID, body.MediaID)
	if err != nil {
		writeSendError(w, err, "not found")
		return
	}
	// Ответ — САМО созданное сервисное сообщение, тем же конструктором, что и
	// любое другое: адрес тройкой полей у него больше нет.
	writeMessage(w, r, h.chat, msg)
}
