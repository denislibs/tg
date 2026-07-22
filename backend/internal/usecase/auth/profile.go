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

// SetEmojiStatus validates and persists the user's emoji status. An empty string
// clears it; otherwise it must be a short unicode emoji (≤ MaxEmojiStatusRunes
// runes), not free text.
func (i *Interactor) SetEmojiStatus(ctx context.Context, id int64, emoji string) (domain.User, error) {
	emoji = strings.TrimSpace(emoji)
	if utf8.RuneCountInString(emoji) > domain.MaxEmojiStatusRunes {
		return domain.User{}, errors.New("emoji status too long")
	}
	return i.users.SetEmojiStatus(ctx, id, emoji)
}

// ActivatePremium flips the user's Telegram Premium flag on. This is a clone: the
// "purchase" is faked, there's no billing — activating simply grants the badge.
func (i *Interactor) ActivatePremium(ctx context.Context, id int64) (domain.User, error) {
	return i.users.SetPremium(ctx, id, true)
}

// CheckoutPremium runs the mock card checkout for a plan: it validates the plan,
// creates or extends the subscription (a still-active subscription is stacked so
// the paid months add to whatever is left) and flips the Premium badge on. Card
// details are validated on the client and ignored here — any well-formed card is
// a "success". It returns the fresh user and the resulting subscription.
func (i *Interactor) CheckoutPremium(ctx context.Context, id int64, planID string) (domain.User, domain.PremiumSubscription, error) {
	plan, ok := domain.PremiumPlanByID(planID)
	if !ok {
		return domain.User{}, domain.PremiumSubscription{}, domain.ErrInvalid
	}
	now := time.Now().UTC()
	// Stack onto remaining time when the current subscription is still active.
	base := now
	if cur, err := i.premium.GetPremiumSubscription(ctx, id); err == nil && cur.ExpiresAt.After(now) {
		base = cur.ExpiresAt
	}
	sub, err := i.premium.UpsertPremiumSubscription(ctx, domain.PremiumSubscription{
		UserID:     id,
		Plan:       plan.ID,
		PriceCents: plan.PriceCents,
		StartedAt:  now,
		ExpiresAt:  base.AddDate(0, plan.Months, 0),
		AutoRenew:  true,
	})
	if err != nil {
		return domain.User{}, domain.PremiumSubscription{}, err
	}
	user, err := i.users.SetPremium(ctx, id, true)
	if err != nil {
		return domain.User{}, domain.PremiumSubscription{}, err
	}
	return user, sub, nil
}

// PremiumSubscription returns the user's current subscription, or
// domain.ErrNotFound when they never subscribed.
func (i *Interactor) PremiumSubscription(ctx context.Context, id int64) (domain.PremiumSubscription, error) {
	return i.premium.GetPremiumSubscription(ctx, id)
}

// CancelPremiumAutoRenew disables auto-renew: the subscription stays active until
// its expiry, then lapses. Returns domain.ErrNotFound when there is none.
func (i *Interactor) CancelPremiumAutoRenew(ctx context.Context, id int64) (domain.PremiumSubscription, error) {
	return i.premium.SetPremiumAutoRenew(ctx, id, false)
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

// SetAvatar stores the avatar URL (a /media/{id}/content path) for the user and
// appends it to the profile-photo gallery so the two stay consistent (Telegram
// keeps every avatar as a gallery photo). Returns the fresh user.
func (i *Interactor) SetAvatar(ctx context.Context, id int64, url string) (domain.User, error) {
	if _, err := i.users.AddProfilePhoto(ctx, id, url, ""); err != nil {
		return domain.User{}, err
	}
	return i.users.GetByID(ctx, id)
}

// AddProfilePhoto adds a photo to the user's gallery and promotes it to the
// current avatar. url/videoURL are already-converted /media/{id}/content paths
// (the delivery layer does the media_id→url conversion, as SetAvatar does).
func (i *Interactor) AddProfilePhoto(ctx context.Context, userID int64, url, videoURL string) (domain.ProfilePhoto, error) {
	return i.users.AddProfilePhoto(ctx, userID, url, videoURL)
}

// ListProfilePhotos returns a user's profile-photo gallery, newest first.
func (i *Interactor) ListProfilePhotos(ctx context.Context, userID int64) ([]domain.ProfilePhoto, error) {
	return i.users.ListProfilePhotos(ctx, userID)
}

// DeleteProfilePhoto removes a gallery photo; when it was the current avatar the
// repo falls avatar_url back to the next most-recent photo (or "").
func (i *Interactor) DeleteProfilePhoto(ctx context.Context, userID, photoID int64) error {
	_, err := i.users.DeleteProfilePhoto(ctx, userID, photoID)
	return err
}
