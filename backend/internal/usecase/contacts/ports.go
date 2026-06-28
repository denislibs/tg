// Package contacts is the address-book application logic (interactor + ports).
package contacts

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// ContactsRepo is the persistence the interactor needs. Add is an upsert keyed on
// (owner, user); List/Delete are scoped to the owner so a user only ever touches
// their own address book.
type ContactsRepo interface {
	Add(ctx context.Context, c domain.Contact) (domain.Contact, error)
	List(ctx context.Context, ownerID int64) ([]domain.Contact, error)
	Delete(ctx context.Context, ownerID, userID int64) (found bool, err error)
}
