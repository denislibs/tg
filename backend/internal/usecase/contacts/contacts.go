package contacts

import (
	"context"
	"errors"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// ErrNameRequired is returned when adding a contact without a first name (the
// only required field, mirroring Telegram's "Имя (обязательно)").
var ErrNameRequired = errors.New("first name is required")

// ErrSelfContact is returned when a user tries to add themselves.
var ErrSelfContact = errors.New("cannot add yourself as a contact")

// Interactor is the contacts application service.
type Interactor struct{ repo ContactsRepo }

func New(repo ContactsRepo) *Interactor { return &Interactor{repo: repo} }

// AddInput is the payload for saving (or editing) a contact.
type AddInput struct {
	UserID     int64
	FirstName  string
	LastName   string
	Note       string
	SharePhone bool
}

// Add saves a contact in ownerID's address book. Re-adding the same user edits the
// existing entry (upsert). Returns the stored contact enriched with the peer's
// profile fields.
func (i *Interactor) Add(ctx context.Context, ownerID int64, in AddInput) (domain.Contact, error) {
	if in.UserID == ownerID {
		return domain.Contact{}, ErrSelfContact
	}
	first := strings.TrimSpace(in.FirstName)
	if first == "" {
		return domain.Contact{}, ErrNameRequired
	}
	return i.repo.Add(ctx, domain.Contact{
		OwnerID:    ownerID,
		UserID:     in.UserID,
		FirstName:  first,
		LastName:   strings.TrimSpace(in.LastName),
		Note:       strings.TrimSpace(in.Note),
		SharePhone: in.SharePhone,
	})
}

// List returns ownerID's address book, ordered by saved name.
func (i *Interactor) List(ctx context.Context, ownerID int64) ([]domain.Contact, error) {
	return i.repo.List(ctx, ownerID)
}

// Delete removes a contact from ownerID's address book; found is false when there
// was no such entry.
func (i *Interactor) Delete(ctx context.Context, ownerID, userID int64) (bool, error) {
	return i.repo.Delete(ctx, ownerID, userID)
}
