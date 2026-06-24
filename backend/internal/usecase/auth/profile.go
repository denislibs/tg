package auth

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

const maxBioLen = 70

// ProfileInput carries the editable profile fields for UpdateProfile.
type ProfileInput struct {
	FirstName       string
	LastName        string
	Bio             string
	Birthday        *time.Time
	PhoneVisibility string
}

// GetUser returns the full, fresh user record from the store. The user in the
// request context is a (possibly cached) session copy that can be stale right
// after an edit, so profile reads/writes go through here.
func (i *Interactor) GetUser(ctx context.Context, id int64) (domain.User, error) {
	return i.users.GetByID(ctx, id)
}

// UpdateProfile validates and persists the editable profile fields, recomputing
// the cached display name.
func (i *Interactor) UpdateProfile(ctx context.Context, id int64, in ProfileInput) (domain.User, error) {
	first := strings.TrimSpace(in.FirstName)
	if first == "" {
		return domain.User{}, errors.New("first name required")
	}
	if utf8.RuneCountInString(in.Bio) > maxBioLen {
		return domain.User{}, errors.New("bio too long")
	}
	pv := in.PhoneVisibility
	if pv == "" {
		pv = domain.PhoneVisibilityContacts
	}
	if !domain.ValidPhoneVisibility(pv) {
		return domain.User{}, errors.New("invalid phone visibility")
	}
	return i.users.UpdateProfile(ctx, id, first, strings.TrimSpace(in.LastName), in.Bio, in.Birthday, pv)
}

// CheckUsername validates the format and reports whether the username is free
// for the given user (its own current username counts as available).
func (i *Interactor) CheckUsername(ctx context.Context, raw string, forUserID int64) (bool, error) {
	n := domain.NormalizeUsername(raw)
	if err := domain.ValidateUsername(n); err != nil {
		return false, err
	}
	return i.users.UsernameAvailable(ctx, n, forUserID)
}

// SetUsername sets the username (empty clears it), returning domain.ErrConflict
// when already taken or a format error for an invalid value.
func (i *Interactor) SetUsername(ctx context.Context, id int64, raw string) (domain.User, error) {
	n := domain.NormalizeUsername(raw)
	if n == "" {
		return i.users.SetUsername(ctx, id, nil)
	}
	if err := domain.ValidateUsername(n); err != nil {
		return domain.User{}, err
	}
	return i.users.SetUsername(ctx, id, &n)
}

// SetAvatar stores the avatar URL (a /media/{id}/content path) for the user.
func (i *Interactor) SetAvatar(ctx context.Context, id int64, url string) (domain.User, error) {
	return i.users.SetAvatar(ctx, id, url)
}
