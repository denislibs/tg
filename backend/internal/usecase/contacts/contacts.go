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
type Interactor struct {
	repo    ContactsRepo
	privacy PrivacyChecker
}

func New(repo ContactsRepo) *Interactor { return &Interactor{repo: repo} }

// SetPrivacy подключает фильтр видимости телефонов (optional).
func (i *Interactor) SetPrivacy(p PrivacyChecker) { i.privacy = p }

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

// List returns ownerID's address book, ordered by saved name. Телефон контакта
// скрывается, когда его правило «кто видит мой номер» не разрешает показ.
func (i *Interactor) List(ctx context.Context, ownerID int64) ([]domain.Contact, error) {
	list, err := i.repo.List(ctx, ownerID)
	if err != nil || i.privacy == nil || len(list) == 0 {
		return list, err
	}
	ids := make([]int64, 0, len(list))
	for _, c := range list {
		ids = append(ids, c.UserID)
	}
	vis, err := i.privacy.VisibleMap(ctx, ownerID, ids, domain.PrivacyPhoneNumber)
	if err != nil {
		return nil, err
	}
	for idx := range list {
		if !vis[list[idx].UserID] {
			list[idx].Phone = ""
		}
	}
	return list, nil
}

// Delete removes a contact from ownerID's address book; found is false when there
// was no such entry.
func (i *Interactor) Delete(ctx context.Context, ownerID, userID int64) (bool, error) {
	return i.repo.Delete(ctx, ownerID, userID)
}
