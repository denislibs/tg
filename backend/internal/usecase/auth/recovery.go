package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

const (
	// recoveryCodeTTL — сколько живёт код сброса пароля, присланный на почту.
	recoveryCodeTTL = 10 * time.Minute
	// recoveryResendInterval — серверный таймер повторной отправки (в tweb
	// кнопка «отправить ещё раз» разблокируется через 30 с; полагаться на
	// клиентский таймер нельзя).
	recoveryResendInterval = 30 * time.Second
	// maxRecoveryAttempts — сколько неверных кодов допускается на один
	// password_token, прежде чем и код, и токен сгорят.
	maxRecoveryAttempts = 5
)

var (
	// ErrRecoveryUnavailable — к аккаунту не привязана почта восстановления
	// (Telegram PASSWORD_RECOVERY_NA).
	ErrRecoveryUnavailable = errors.New("password recovery unavailable")
	// ErrResendTooSoon — повторная отправка кода запрошена до истечения таймера.
	ErrResendTooSoon = errors.New("recovery resend too soon")
)

// RecoveryRequest — что клиент показывает на экране «сброс пароля по почте».
type RecoveryRequest struct {
	// EmailPattern — маскированный адрес (Telegram email_pattern). Полный адрес
	// наружу не отдаём никогда.
	EmailPattern string
	// ResendAfter — секунды до следующей разрешённой отправки. При
	// ErrResendTooSoon — сколько ещё ждать.
	ResendAfter int
}

// RequestPasswordRecovery — «забыли пароль?» на шаге облачного пароля: по
// одноразовому password_token отправляет код на привязанную почту и возвращает
// её маскированный вид (Telegram auth.requestPasswordRecovery).
func (i *Interactor) RequestPasswordRecovery(ctx context.Context, rawPasswordToken string) (RecoveryRequest, error) {
	if i.steps == nil || i.pw == nil {
		return RecoveryRequest{}, ErrLoginStepsUnavailable
	}
	tokenHash := domain.HashToken(rawPasswordToken)
	userID, err := i.pw.PasswordTokenUser(ctx, tokenHash)
	if err != nil {
		return RecoveryRequest{}, err // ErrNotFound → токен истёк
	}
	hash, _, email, err := i.pw.Password(ctx, userID)
	if err != nil {
		return RecoveryRequest{}, err
	}
	if hash == nil || email == "" {
		return RecoveryRequest{}, ErrRecoveryUnavailable
	}
	now := time.Now()
	// Таймер повторной отправки держит сервер: клиент не может его обойти.
	if _, _, nextSendAt, err := i.steps.RecoveryCode(ctx, tokenHash); err == nil && now.Before(nextSendAt) {
		return RecoveryRequest{
			EmailPattern: domain.MaskEmail(email),
			ResendAfter:  secondsUntil(now, nextSendAt),
		}, ErrResendTooSoon
	}

	code, err := i.recoveryCode()
	if err != nil {
		return RecoveryRequest{}, err
	}
	// Сначала доставка, потом запись: иначе на экране висел бы код, который
	// никуда не ушёл. Без подключённого Mailer код совпадает с dev-OTP.
	if i.mail != nil {
		if err := i.mail.SendRecoveryCode(ctx, email, code); err != nil {
			return RecoveryRequest{}, err
		}
	}
	// Хранится только хеш кода. Сам по себе он бесполезен: чтобы им
	// воспользоваться, нужен ещё и сырой password_token (в базе лежит его хеш).
	if err := i.steps.SaveRecoveryCode(ctx, tokenHash, userID, domain.HashToken(code),
		now.Add(recoveryCodeTTL), now.Add(recoveryResendInterval)); err != nil {
		return RecoveryRequest{}, err
	}
	// Шаг пароля продлеваем: восстановление по почте длиннее ввода пароля.
	if err := i.pw.SavePasswordToken(ctx, tokenHash, userID, now.Add(passwordTokenTTL)); err != nil {
		return RecoveryRequest{}, err
	}
	i.recFails.clear(tokenHash) // новый код — новый лимит попыток
	// Ни код, ни адрес не логируем.
	i.logf("[recovery] code sent for user=%d", userID)
	return RecoveryRequest{
		EmailPattern: domain.MaskEmail(email),
		ResendAfter:  int(recoveryResendInterval / time.Second),
	}, nil
}

// ConfirmPasswordRecovery — код с почты: снимает облачный пароль и выдаёт
// сессию (Telegram auth.recoverPassword). Код одноразовый; после
// maxRecoveryAttempts неудач сгорает вместе с password_token.
func (i *Interactor) ConfirmPasswordRecovery(ctx context.Context, rawPasswordToken, code, deviceName, platform string) (SignInResult, error) {
	if i.steps == nil || i.pw == nil {
		return SignInResult{}, ErrLoginStepsUnavailable
	}
	tokenHash := domain.HashToken(rawPasswordToken)
	userID, codeHash, _, err := i.steps.RecoveryCode(ctx, tokenHash)
	if err != nil {
		return SignInResult{}, err // ErrNotFound → кода нет/истёк
	}
	if !domain.CodeMatches(codeHash, domain.HashToken(code)) {
		if i.recFails.inc(tokenHash) >= maxRecoveryAttempts {
			_ = i.steps.DeleteRecoveryCode(ctx, tokenHash)
			_ = i.pw.DeletePasswordToken(ctx, tokenHash)
			i.recFails.clear(tokenHash)
			return SignInResult{}, domain.ErrNotFound // исчерпан → как истёкший
		}
		return SignInResult{}, domain.ErrInvalidCode
	}
	// Сброс облачного пароля целиком: хеш, подсказка и почта (как RemovePassword).
	if err := i.pw.SetPassword(ctx, userID, nil, "", ""); err != nil {
		return SignInResult{}, err
	}
	user, err := i.users.GetByID(ctx, userID)
	if err != nil {
		return SignInResult{}, err
	}
	res, err := i.mintSession(ctx, user, deviceName, platform)
	if err != nil {
		return SignInResult{}, err
	}
	i.recFails.clear(tokenHash)
	_ = i.steps.DeleteRecoveryCode(ctx, tokenHash)
	_ = i.pw.DeletePasswordToken(ctx, tokenHash)
	return res, nil
}

// RecoveryCodeLength — длина кода восстановления. Шесть цифр, как у Telegram;
// поле ввода на экране восстановления рассчитано ровно на эту длину.
const RecoveryCodeLength = 6

// recoveryCode — код письма. Без подключённого Mailer доставки нет, поэтому
// код статичен и выводится из dev-OTP (DEV_OTP_CODE) — так же, как код входа по
// SMS на стенде. С Mailer — случайные 6 цифр.
func (i *Interactor) recoveryCode() (string, error) {
	if i.mail == nil {
		// dev-OTP пятизначный, а поле ввода ждёт шесть: без выравнивания
		// автоотправка по заполнению не срабатывала никогда и сценарий
		// восстановления через интерфейс был непроходим на стенде.
		return padCode(i.devCode, RecoveryCodeLength), nil
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return string([]byte{
		byte('0' + n.Int64()/100000%10),
		byte('0' + n.Int64()/10000%10),
		byte('0' + n.Int64()/1000%10),
		byte('0' + n.Int64()/100%10),
		byte('0' + n.Int64()/10%10),
		byte('0' + n.Int64()%10),
	}), nil
}

// padCode дополняет код нулями слева до нужной длины (длиннее — не трогает).
func padCode(code string, n int) string {
	if len(code) >= n {
		return code
	}
	return strings.Repeat("0", n-len(code)) + code
}

// secondsUntil — сколько целых секунд осталось до момента t (минимум 1).
func secondsUntil(now, t time.Time) int {
	d := t.Sub(now)
	if d <= 0 {
		return 0
	}
	s := int((d + time.Second - 1) / time.Second)
	if s < 1 {
		s = 1
	}
	return s
}
