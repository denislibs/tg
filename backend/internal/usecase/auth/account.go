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

// ErrRecoveryAvailable — сброс аккаунта запрошен, хотя к облачному паролю
// привязана почта: восстановление возможно, значит удалять нечего. Обратная
// сторона ErrRecoveryUnavailable (Telegram PASSWORD_RECOVERY_NA).
var ErrRecoveryAvailable = errors.New("password recovery available")

// ResetAccount — «забыли пароль?» при облачном пароле БЕЗ привязанной почты:
// восстановить его нечем, и единственный выход в Telegram — удалить аккаунт и
// начать заново (в tweb — account.deleteAccount('Forgot password') после
// PASSWORD_RECOVERY_NA).
//
// Авторизует сам одноразовый password_token из SignIn: сессии на этом шаге ещё
// нет. Разрешено ТОЛЬКО когда почта не привязана — иначе знание номера и SMS-кода
// давало бы удаление чужого аккаунта в обход второго фактора.
func (i *Interactor) ResetAccount(ctx context.Context, rawPasswordToken string) error {
	if i.pw == nil {
		return ErrLoginStepsUnavailable
	}
	tokenHash := domain.HashToken(rawPasswordToken)
	userID, err := i.pw.PasswordTokenUser(ctx, tokenHash)
	if err != nil {
		return err // ErrNotFound → токен истёк/использован/неизвестен
	}
	hash, _, email, err := i.pw.Password(ctx, userID)
	if err != nil {
		return err
	}
	if hash != nil && email != "" {
		return ErrRecoveryAvailable
	}
	// Снимаем облачный пароль до удаления: строка 2FA живёт отдельно от users и
	// пережила бы анонимизацию, оставив хеш и подсказку от мёртвого аккаунта.
	if err := i.pw.SetPassword(ctx, userID, nil, "", ""); err != nil {
		return err
	}
	// Анонимизация + отзыв всех сессий — общий путь с удалением из настроек.
	if err := i.DeleteAccount(ctx, userID); err != nil {
		return err
	}
	i.pwFails.clear(tokenHash)
	_ = i.pw.DeletePasswordToken(ctx, tokenHash) // шаг пароля сгорает
	// Токен не логируем — только факт сброса.
	i.logf("[auth] account reset (no recovery email) user=%d", userID)
	return nil
}
