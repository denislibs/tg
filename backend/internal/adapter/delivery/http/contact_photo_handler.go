package http

import (
	"encoding/json"
	"errors"
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
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "suggest photo failed")
		return
	}
	// Ответ — САМО созданное сервисное сообщение, тем же конструктором, что и
	// любое другое: адрес тройкой полей у него больше нет.
	writeMessage(w, r, h.chat, msg)
}

// AcceptSuggestion accepts a suggested profile photo
// (POST /chats/{peerID}/photo_suggestions/{msgSeq}/accept): the photo becomes
// the caller's avatar.
//
// Ключ пира появился в адресе не для красоты: предложение это СООБЩЕНИЕ, а
// сообщение адресуется парой «пир + номер». Прежний /photo_suggestions/{id}
// нёс внутренний ключ строки — единственное число, которым такой адрес
// вообще мог существовать без пира.
func (h *ContactPhotoHandler) AcceptSuggestion(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	chatID, ok := peerChatID(w, r, h.chat)
	if !ok {
		return
	}
	msgID, ok := msgSeqID(w, r, h.chat, chatID)
	if !ok {
		return
	}
	err := h.chat.AcceptProfilePhotoSuggestion(r.Context(), u.ID, msgID)
	switch {
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
		return
	case errors.Is(err, domain.ErrConflict):
		writeError(w, http.StatusConflict, "already_accepted")
		return
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found")
		return
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "accept suggestion failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
