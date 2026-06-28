package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecasecontacts "github.com/messenger-denis/backend/internal/usecase/contacts"
)

// ContactsHandler serves the current user's address book.
type ContactsHandler struct{ uc *usecasecontacts.Interactor }

func NewContactsHandler(uc *usecasecontacts.Interactor) *ContactsHandler {
	return &ContactsHandler{uc: uc}
}

// contactJSON is the wire shape for one address-book entry.
func contactJSON(c domain.Contact) map[string]any {
	var username any
	if c.Username != nil {
		username = *c.Username
	}
	return map[string]any{
		"user_id":      c.UserID,
		"first_name":   c.FirstName,
		"last_name":    c.LastName,
		"note":         c.Note,
		"share_phone":  c.SharePhone,
		"username":     username,
		"avatar_url":   c.AvatarURL,
		"phone":        c.Phone,
		"display_name": c.DisplayName,
		"created_at":   c.CreatedAt,
	}
}

type addContactBody struct {
	ContactID  int64  `json:"contact_id"`
	FirstName  string `json:"first_name"`
	LastName   string `json:"last_name"`
	Note       string `json:"note"`
	SharePhone bool   `json:"share_phone"`
}

// Add saves (or edits) a contact: POST /contacts.
func (h *ContactsHandler) Add(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	var body addContactBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	c, err := h.uc.Add(r.Context(), u.ID, usecasecontacts.AddInput{
		UserID:     body.ContactID,
		FirstName:  body.FirstName,
		LastName:   body.LastName,
		Note:       body.Note,
		SharePhone: body.SharePhone,
	})
	switch {
	case errors.Is(err, usecasecontacts.ErrNameRequired):
		writeError(w, http.StatusBadRequest, "first_name_required")
		return
	case errors.Is(err, usecasecontacts.ErrSelfContact):
		writeError(w, http.StatusBadRequest, "cannot_add_self")
		return
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "user not found")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "add contact failed")
		return
	}
	writeJSON(w, http.StatusCreated, contactJSON(c))
}

// List returns the current user's address book: GET /contacts.
func (h *ContactsHandler) List(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	contacts, err := h.uc.List(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list contacts failed")
		return
	}
	out := make([]map[string]any, 0, len(contacts))
	for _, c := range contacts {
		out = append(out, contactJSON(c))
	}
	writeJSON(w, http.StatusOK, map[string]any{"contacts": out})
}

// Delete removes a contact: DELETE /contacts/{userID}.
func (h *ContactsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	userID, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	found, err := h.uc.Delete(r.Context(), u.ID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "delete contact failed")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "contact not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
