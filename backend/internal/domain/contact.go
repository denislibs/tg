package domain

import "time"

// Contact is one entry in a user's address book: the owner (OwnerID) saved another
// user (UserID) under a name of their own choosing, optionally with a note and a
// "let them see my phone number" flag. The saved name is the owner's — it does not
// change the contact's own profile name.
type Contact struct {
	OwnerID    int64
	UserID     int64
	FirstName  string
	LastName   string
	Note       string
	SharePhone bool
	CreatedAt  time.Time
	// Enriched from the users table by the read model (not stored on the contacts
	// row) so a list can render the peer's avatar/username/phone without a second
	// round-trip. Zero/nil when looked up without the join.
	Username    *string
	AvatarURL   string
	Phone       string
	DisplayName string
	// HasCustomPhoto — у владельца задано личное фото этого контакта (AvatarURL
	// уже подменён им). Позволяет UI показать «Изменить»/«Сбросить» фото.
	HasCustomPhoto bool
}
