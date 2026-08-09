package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeMailer запоминает последнее письмо (адрес + код) вместо отправки.
type fakeMailer struct {
	email string
	code  string
	sends int
	err   error
}

func (m *fakeMailer) SendRecoveryCode(_ context.Context, email, code string) error {
	if m.err != nil {
		return m.err
	}
	m.email, m.code, m.sends = email, code, m.sends+1
	return nil
}

// twoFactorLogin: регистрирует номер, ставит облачный пароль с почтой и
// доводит вход до шага пароля. Возвращает id пользователя и password_token.
func twoFactorLogin(t *testing.T, i *Interactor, codes *fakeCodeRepo, phone, email string) (int64, string) {
	t.Helper()
	ctx := context.Background()
	res := registerUser(t, i, phone, "Восстановление", "", "dev", "test")
	if err := i.SetPassword(ctx, res.User.ID, "", "s3cret", "hint", email); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	_ = codes.SaveCode(ctx, phone, "12345", time.Now().Add(time.Hour))
	step, err := i.SignIn(ctx, phone, "12345", "dev", "test")
	if err != nil || !step.PasswordNeeded {
		t.Fatalf("2fa sign in = %+v, %v", step, err)
	}
	return res.User.ID, step.PasswordToken
}

// Полный путь восстановления: код на почту → сброс пароля → сессия.
func TestPasswordRecovery_Flow(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()
	mail := &fakeMailer{}
	i.SetMailer(mail)

	userID, pwToken := twoFactorLogin(t, i, codes, "+79990020001", "denis@example.com")

	req, err := i.RequestPasswordRecovery(ctx, pwToken)
	if err != nil {
		t.Fatalf("RequestPasswordRecovery: %v", err)
	}
	// Наружу — только маскированный адрес.
	if req.EmailPattern != "d****@e******.com" {
		t.Fatalf("email_pattern = %q", req.EmailPattern)
	}
	if req.ResendAfter != int(recoveryResendInterval/time.Second) {
		t.Fatalf("resend_after = %d", req.ResendAfter)
	}
	if mail.sends != 1 || mail.email != "denis@example.com" || len(mail.code) != 6 {
		t.Fatalf("письмо не отправлено как ожидалось: %+v", mail)
	}

	// Неверный код — отказ, но не сжигает попытку восстановления целиком.
	if _, err := i.ConfirmPasswordRecovery(ctx, pwToken, "000000", "dev", "test"); !errors.Is(err, domain.ErrInvalidCode) {
		t.Fatalf("неверный код = %v, want ErrInvalidCode", err)
	}

	res, err := i.ConfirmPasswordRecovery(ctx, pwToken, mail.code, "dev", "test")
	if err != nil {
		t.Fatalf("ConfirmPasswordRecovery: %v", err)
	}
	if res.Token == "" || res.User.ID != userID {
		t.Fatalf("восстановление не выдало сессию: %+v", res)
	}
	// Облачный пароль снят целиком (хеш, подсказка, почта).
	st, err := i.PasswordState(ctx, userID)
	if err != nil || st.Enabled || st.Hint != "" || st.Email != "" {
		t.Fatalf("PasswordState после сброса = %+v, %v", st, err)
	}
	// Код и шаг пароля одноразовые.
	if _, err := i.ConfirmPasswordRecovery(ctx, pwToken, mail.code, "dev", "test"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("повторное подтверждение = %v, want ErrNotFound", err)
	}
}

// Повторная отправка ограничена сервером: до истечения таймера — ErrResendTooSoon
// с остатком секунд, письмо не уходит.
func TestPasswordRecovery_ResendThrottled(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()
	mail := &fakeMailer{}
	i.SetMailer(mail)

	_, pwToken := twoFactorLogin(t, i, codes, "+79990020002", "denis@example.com")

	if _, err := i.RequestPasswordRecovery(ctx, pwToken); err != nil {
		t.Fatalf("первая отправка: %v", err)
	}
	req, err := i.RequestPasswordRecovery(ctx, pwToken)
	if !errors.Is(err, ErrResendTooSoon) {
		t.Fatalf("повторная отправка = %v, want ErrResendTooSoon", err)
	}
	if req.ResendAfter <= 0 || req.ResendAfter > int(recoveryResendInterval/time.Second) {
		t.Fatalf("retry_after = %d", req.ResendAfter)
	}
	if mail.sends != 1 {
		t.Fatalf("письмо ушло повторно: %d", mail.sends)
	}
}

// Перебор кода: после maxRecoveryAttempts неудач сгорают и код, и password_token.
func TestPasswordRecovery_AttemptCap(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()
	mail := &fakeMailer{}
	i.SetMailer(mail)

	_, pwToken := twoFactorLogin(t, i, codes, "+79990020003", "denis@example.com")
	if _, err := i.RequestPasswordRecovery(ctx, pwToken); err != nil {
		t.Fatalf("RequestPasswordRecovery: %v", err)
	}

	for n := 1; n < maxRecoveryAttempts; n++ {
		if _, err := i.ConfirmPasswordRecovery(ctx, pwToken, "000000", "dev", "test"); !errors.Is(err, domain.ErrInvalidCode) {
			t.Fatalf("попытка %d = %v, want ErrInvalidCode", n, err)
		}
	}
	if _, err := i.ConfirmPasswordRecovery(ctx, pwToken, "000000", "dev", "test"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("попытка %d = %v, want ErrNotFound (сожжён)", maxRecoveryAttempts, err)
	}
	// Даже верный код после сжигания не проходит, и шаг пароля тоже мёртв.
	if _, err := i.ConfirmPasswordRecovery(ctx, pwToken, mail.code, "dev", "test"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("верный код после сжигания = %v, want ErrNotFound", err)
	}
	if _, err := i.CheckPassword(ctx, pwToken, "s3cret", "dev", "test"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("password_token должен был сгореть, got %v", err)
	}
}

// Отказы: протухший шаг пароля и аккаунт без привязанной почты.
func TestPasswordRecovery_Rejections(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()
	i.SetMailer(&fakeMailer{})

	if _, err := i.RequestPasswordRecovery(ctx, "deadbeef"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("неизвестный password_token = %v, want ErrNotFound", err)
	}
	if _, err := i.ConfirmPasswordRecovery(ctx, "deadbeef", "000000", "dev", "test"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("подтверждение без запроса = %v, want ErrNotFound", err)
	}

	// Пароль есть, почты нет → восстановление недоступно (PASSWORD_RECOVERY_NA).
	_, pwToken := twoFactorLogin(t, i, codes, "+79990020004", "")
	if _, err := i.RequestPasswordRecovery(ctx, pwToken); !errors.Is(err, ErrRecoveryUnavailable) {
		t.Fatalf("без почты = %v, want ErrRecoveryUnavailable", err)
	}
}

// Без подключённого Mailer код выводится из dev-OTP — как код входа по SMS на
// стенде, но дополненный нулями до шести цифр: поле ввода на экране
// восстановления рассчитано ровно на RecoveryCodeLength, и пятизначный код
// никогда не давал автоотправки по заполнению.
func TestPasswordRecovery_DevCodeWithoutMailer(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()

	userID, pwToken := twoFactorLogin(t, i, codes, "+79990020005", "denis@example.com")
	if _, err := i.RequestPasswordRecovery(ctx, pwToken); err != nil {
		t.Fatalf("RequestPasswordRecovery: %v", err)
	}
	// Пятизначный dev-OTP «12345» на экране восстановления вводится как «012345».
	if _, err := i.ConfirmPasswordRecovery(ctx, pwToken, "12345", "dev", "test"); err == nil {
		t.Fatal("пятизначный dev-код принят, ожидался отказ")
	}
	res, err := i.ConfirmPasswordRecovery(ctx, pwToken, padCode("12345", RecoveryCodeLength), "dev", "test")
	if err != nil || res.User.ID != userID || res.Token == "" {
		t.Fatalf("подтверждение dev-кодом = %+v, %v", res, err)
	}
}
