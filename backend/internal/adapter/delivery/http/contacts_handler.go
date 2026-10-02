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
// contactJSON — одна запись адресной книги: НАША часть (заметка, «показывать
// мой номер», дата) плюс сам пир конструктором `user`. Раскладка та же, что у
// contacts.contacts в схеме: строка контакта отдельно, тело пира отдельно.
// contactsContainer — адресная книга контейнером `contacts.contacts`.
//
// СТРОКА книги это ссылка (`contact{user_id, mutual}`), а карточки едут
// вектором `users`: прежде карточка была вклеена в каждую строку рядом со
// ссылкой — тот же снимок-вместо-ссылки, что убирался у диалогов.
//
// Наши поля строки (`share_phone`, `has_custom_photo`, `created_at`) у
// конструктора места не имеют. Заметка у оригинала — не поле строки книги, а
// userFull.note: она едет полной карточкой (/users/{id}); номером делятся
// правилом приватности.
func contactsContainer(list []domain.ContactRecord) domain.ContactsContacts {
	rows := make([]domain.Contact, 0, len(list))
	cards := make([]domain.UserReal, 0, len(list))
	for _, c := range list {
		// Взаимность — тот же флаг карточки, что ставит линза зрителя
		// (domain.UserReal.SeenBy): зритель есть в книге самого контакта.
		rows = append(rows, domain.NewContact(c.UserID, c.User.MutualContact()))
		cards = append(cards, c.User)
	}
	return domain.NewContactsContacts(rows, cards)
}

type addContactBody struct {
	ContactID int64  `json:"contact_id"`
	Phone     string `json:"phone"` // добавление по номеру (когда contact_id == 0)
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	// Note — contacts.addContact.note:flags.1?TextWithEntities. Ключа нет —
	// заметка не трогается (правка одного имени её не стирает).
	Note       *domain.TextWithEntities `json:"note"`
	SharePhone bool                     `json:"share_phone"`
}

// Add saves (or edits) a contact: POST /contacts. Принимает либо contact_id
// (существующий пользователь), либо phone (резолв номера, как tweb importContact).
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

	var (
		c   domain.ContactRecord
		err error
	)
	if body.ContactID == 0 && body.Phone != "" {
		c, err = h.uc.AddByPhone(r.Context(), u.ID, usecasecontacts.AddByPhoneInput{
			Phone:      body.Phone,
			FirstName:  body.FirstName,
			LastName:   body.LastName,
			Note:       body.Note,
			SharePhone: body.SharePhone,
		})
	} else {
		c, err = h.uc.Add(r.Context(), u.ID, usecasecontacts.AddInput{
			UserID:     body.ContactID,
			FirstName:  body.FirstName,
			LastName:   body.LastName,
			Note:       body.Note,
			SharePhone: body.SharePhone,
		})
	}
	switch {
	case errors.Is(err, usecasecontacts.ErrNameRequired):
		writeError(w, http.StatusBadRequest, "first_name_required")
		return
	case errors.Is(err, usecasecontacts.ErrPhoneRequired):
		writeError(w, http.StatusBadRequest, "phone_required")
		return
	case errors.Is(err, usecasecontacts.ErrSelfContact):
		writeError(w, http.StatusBadRequest, "cannot_add_self")
		return
	case errors.Is(err, usecasecontacts.ErrCannotAddBot):
		writeError(w, http.StatusBadRequest, "cannot_add_bot")
		return
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "note_too_long")
		return
	case errors.Is(err, domain.ErrPrivacy):
		writeError(w, http.StatusForbidden, "add_by_phone_restricted")
		return
	case errors.Is(err, domain.ErrNotFound):
		// contact_id → пользователь не найден; phone → номер не зарегистрирован.
		writeError(w, http.StatusNotFound, "user_not_found")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "add contact failed")
		return
	}
	writeJSON(w, http.StatusCreated, contactsContainer([]domain.ContactRecord{c}))
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
	writeJSON(w, http.StatusOK, contactsContainer(contacts))
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

type contactNoteBody struct {
	Note *domain.TextWithEntities `json:"note"`
}

// UpdateNote — contacts.updateContactNote: PUT /contacts/{userID}/note,
// тело {note: textWithEntities}. Ответ — Bool, как у оригинала; пустой текст
// стирает заметку. 404 — пира нет в книге.
func (h *ContactsHandler) UpdateNote(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	userID, ok := pathInt(w, r, "userID")
	if !ok {
		return
	}
	var body contactNoteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Note == nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := h.uc.UpdateNote(r.Context(), u.ID, userID, *body.Note)
	switch {
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "note_too_long")
		return
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "contact not found")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "update note failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
