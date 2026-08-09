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

// defaultAccountResetWindow — сколько ждать между запросом сброса и удалением
// аккаунта: неделя, как в Telegram («we will delete it in 1 week for security
// purposes»). Тем же сроком меряется карантин после отмены — текст клиента
// обещает ровно его: «Please try again in 7 days».
const defaultAccountResetWindow = 7 * 24 * time.Hour

var (
	// ErrRecoveryAvailable — сброс аккаунта запрошен, хотя к облачному паролю
	// привязана почта: восстановление возможно, значит удалять нечего. Обратная
	// сторона ErrRecoveryUnavailable (Telegram PASSWORD_RECOVERY_NA).
	ErrRecoveryAvailable = errors.New("password recovery available")
	// ErrResetPending — сброс запланирован, окно ожидания ещё идёт. Вместе с
	// ошибкой возвращается остаток в секундах (Telegram 2FA_CONFIRM_WAIT_<N>).
	ErrResetPending = errors.New("account reset pending")
	// ErrResetRecentConfirm — сброс отменён: владелец за это время заходил в
	// аккаунт (Telegram 2FA_RECENT_CONFIRM).
	ErrResetRecentConfirm = errors.New("account reset recently confirmed")
)

// accountResetWindow — действующее окно ожидания. Переопределяется
// SetAccountResetWindow (ACCOUNT_RESET_WAIT) — иначе сценарий сброса на стенде
// непроверяем: ждать неделю.
func (i *Interactor) accountResetWindow() time.Duration {
	if i.resetWait > 0 {
		return i.resetWait
	}
	return defaultAccountResetWindow
}

// ResetAccount — «забыли пароль?» при облачном пароле БЕЗ привязанной почты:
// восстановить его нечем, и единственный выход в Telegram — удалить аккаунт и
// начать заново (в tweb — account.deleteAccount('Forgot password') после
// PASSWORD_RECOVERY_NA).
//
// Удаление НЕ мгновенное. Первый вызов только планирует его через окно ожидания
// и возвращает ErrResetPending с остатком секунд; исполняет удаление повторный
// вызов, когда окно истекло. Отдельного фонового задания нет — Telegram точно
// так же лишь отдаёт клиенту счётчик 2FA_CONFIRM_WAIT_<секунды>. Смысл окна: у
// настоящего владельца есть неделя, чтобы войти и отменить чужую попытку
// (после этого — ErrResetRecentConfirm).
//
// Авторизует сам одноразовый password_token из SignIn: сессии на этом шаге ещё
// нет. Разрешено ТОЛЬКО когда почта не привязана — иначе знание номера и SMS-кода
// давало бы удаление чужого аккаунта в обход второго фактора.
//
// retryAfter — секунды до исполнения; заполнен только вместе с ErrResetPending.
func (i *Interactor) ResetAccount(ctx context.Context, rawPasswordToken string) (retryAfter int, err error) {
	if i.pw == nil || i.steps == nil {
		return 0, ErrLoginStepsUnavailable
	}
	tokenHash := domain.HashToken(rawPasswordToken)
	userID, err := i.pw.PasswordTokenUser(ctx, tokenHash)
	if err != nil {
		return 0, err // ErrNotFound → токен истёк/использован/неизвестен
	}
	hash, _, email, err := i.pw.Password(ctx, userID)
	if err != nil {
		return 0, err
	}
	if hash != nil && email != "" {
		return 0, ErrRecoveryAvailable
	}

	now := time.Now()
	window := i.accountResetWindow()
	deleteAt, cancelledAt, err := i.steps.AccountReset(ctx, userID)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		// Сброса ещё не заказывали — планируем ниже.
	case err != nil:
		return 0, err
	case !cancelledAt.IsZero():
		// Владелец входил и снял попытку. Карантин той же длины: иначе отменённый
		// сброс тут же перепланировался бы и окно можно было бы крутить вечно.
		if now.Before(cancelledAt.Add(window)) {
			return 0, ErrResetRecentConfirm
		}
		// Карантин выдержан — заказ разрешён заново (планируем ниже).
	case now.Before(deleteAt):
		// Повтор внутри окна — тот же срок, а не новая запись: клиенту показывают
		// обратный отсчёт до фиксированной даты, и продлить/обнулить его нельзя.
		return secondsUntil(now, deleteAt), ErrResetPending
	default:
		return 0, i.executeAccountReset(ctx, userID, tokenHash)
	}

	deleteAt = now.Add(window)
	if err := i.steps.ScheduleAccountReset(ctx, userID, now, deleteAt); err != nil {
		return 0, err
	}
	// Токен не логируем — только факт заказа.
	i.logf("[auth] account reset scheduled user=%d in=%s", userID, window)
	return secondsUntil(now, deleteAt), ErrResetPending
}

// executeAccountReset исполняет дозревший сброс: аккаунт удаляется тем же путём,
// что и «удалить мой аккаунт» из настроек.
func (i *Interactor) executeAccountReset(ctx context.Context, userID int64, tokenHash string) error {
	// Снимаем облачный пароль до удаления: строка 2FA живёт отдельно от users и
	// пережила бы анонимизацию, оставив хеш и подсказку от мёртвого аккаунта.
	if err := i.pw.SetPassword(ctx, userID, nil, "", ""); err != nil {
		return err
	}
	// Анонимизация + отзыв всех сессий — общий путь с удалением из настроек.
	if err := i.DeleteAccount(ctx, userID); err != nil {
		return err
	}
	// Запись сброса исполнена: users остаётся (аккаунт анонимизируется, а не
	// удаляется строкой), поэтому каскад её не заберёт — убираем явно.
	if err := i.steps.DeleteAccountReset(ctx, userID); err != nil {
		return err
	}
	i.pwFails.clear(tokenHash)
	_ = i.pw.DeletePasswordToken(ctx, tokenHash) // шаг пароля сгорает
	i.logf("[auth] account reset executed (no recovery email) user=%d", userID)
	return nil
}

// cancelAccountReset снимает запланированный сброс: владелец только что доказал,
// что аккаунт живой. Вешается на выдачу сессии — а её при включённом облачном
// пароле (а сброс возможен только при нём) даёт лишь пройденный ВТОРОЙ фактор:
// SMS-кода, доступного и атакующему, для отмены не хватает.
//
// Best-effort: отказ хранилища не должен ронять вход.
func (i *Interactor) cancelAccountReset(ctx context.Context, userID int64) {
	if i.steps == nil {
		return
	}
	cancelled, err := i.steps.CancelAccountReset(ctx, userID, time.Now())
	if err != nil {
		i.logf("cancel account reset failed for user=%d: %v", userID, err)
		return
	}
	if cancelled {
		i.logf("[auth] account reset cancelled by owner login user=%d", userID)
	}
}
