package auth

import (
	"context"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// ChangePhone starts a phone-number change for an authenticated user: it
// validates and normalizes the new number, ensures it is not already used by
// another account, and sends a verification code to it (dev OTP). The change is
// only committed by ConfirmChangePhone once the code is verified.
func (i *Interactor) ChangePhone(ctx context.Context, userID int64, rawPhone string) error {
	phone := domain.NormalizePhone(rawPhone)
	if phone == "" {
		return domain.ErrInvalid
	}
	inUse, err := i.users.PhoneInUse(ctx, phone, userID)
	if err != nil {
		return err
	}
	if inUse {
		return domain.ErrConflict
	}
	if err := i.codes.SaveCode(ctx, phone, i.devCode, time.Now().Add(codeTTL)); err != nil {
		return err
	}
	i.logf("[dev-otp] change-phone user=%d phone=%s code=%s", userID, phone, i.devCode)
	return nil
}

// ConfirmChangePhone verifies the code sent to the new number and, if valid,
// updates the user's phone. Uniqueness is re-checked atomically by the store
// (unique constraint → domain.ErrConflict) to guard against a race where the
// number was claimed between ChangePhone and here. Returns the fresh user.
func (i *Interactor) ConfirmChangePhone(ctx context.Context, userID int64, rawPhone, suppliedCode string) (domain.User, error) {
	phone := domain.NormalizePhone(rawPhone)
	if phone == "" {
		return domain.User{}, domain.ErrInvalid
	}
	stored, err := i.codes.GetCode(ctx, phone)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.User{}, domain.ErrInvalidCode
	}
	if err != nil {
		return domain.User{}, err
	}
	if !domain.CodeMatches(stored, suppliedCode) {
		return domain.User{}, domain.ErrInvalidCode
	}
	user, err := i.users.UpdatePhone(ctx, userID, phone)
	if err != nil {
		return domain.User{}, err // domain.ErrConflict on a uniqueness race
	}
	_ = i.codes.DeleteCode(ctx, phone)
	return user, nil
}

// DeleteAccount soft-deletes (anonymizes) the account like Telegram's "Delete my
// account": personal fields are cleared, the phone number is freed, and every
// session/device is revoked (caches evicted, sockets closed). Message history is
// intentionally preserved — it stays attributed to a "Deleted Account".
func (i *Interactor) DeleteAccount(ctx context.Context, userID int64) error {
	if err := i.users.SoftDelete(ctx, userID); err != nil {
		return err
	}
	removed, err := i.devices.DeleteAll(ctx, userID)
	if err != nil {
		return err
	}
	for _, d := range removed {
		if i.cache != nil {
			_ = i.cache.DelSession(ctx, d.TokenHash)
		}
		if i.revoker != nil {
			_ = i.revoker.NotifyRevoked(ctx, d.ID)
		}
	}
	return nil
}
