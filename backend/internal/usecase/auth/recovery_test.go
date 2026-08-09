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

// Восстановление невозможно (почта не привязана) → сброс аккаунта: единственный
// выход в Telegram, tweb зовёт account.deleteAccount после PASSWORD_RECOVERY_NA.
// Аккаунт анонимизируется, номер освобождается, все сессии отзываются, шаг
// пароля сгорает.
func TestResetAccount_NoRecoveryEmail(t *testing.T) {
	ctx := context.Background()
	i, users, _, codes := newInteractor()
	cache := newFakeCache()
	rev := &fakeRevoker{}
	i.SetCache(cache)
	i.SetRevocationNotifier(rev)

	userID, pwToken := twoFactorLogin(t, i, codes, "+79990020010", "")
	// Сессия, выданная до включения 2FA, должна быть отозвана вместе с аккаунтом.
	sessions, _ := i.ListSessions(ctx, userID)
	if len(sessions) == 0 {
		t.Fatal("нет активных сессий до сброса — тест бессмысленен")
	}

	if err := i.ResetAccount(ctx, pwToken); err != nil {
		t.Fatalf("ResetAccount: %v", err)
	}

	u, err := users.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID после сброса: %v", err)
	}
	if u.Phone != "" || u.DisplayName != "Deleted Account" {
		t.Fatalf("аккаунт не анонимизирован: %+v", u)
	}
	if sessions, _ := i.ListSessions(ctx, userID); len(sessions) != 0 {
		t.Fatalf("остались сессии после сброса: %d", len(sessions))
	}
	if len(cache.m) != 0 {
		t.Fatalf("кэш сессий не вычищен: %d записей", len(cache.m))
	}
	if len(rev.revoked) == 0 {
		t.Fatal("сокеты удалённых сессий не закрыты (NotifyRevoked не вызван)")
	}
	// Облачный пароль снят: строка 2FA живёт отдельно от users и пережила бы
	// анонимизацию.
	if st, err := i.PasswordState(ctx, userID); err != nil || st.Enabled || st.Email != "" {
		t.Fatalf("PasswordState после сброса = %+v, %v", st, err)
	}
	// Токен шага пароля одноразовый.
	if err := i.ResetAccount(ctx, pwToken); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("повторный сброс = %v, want ErrNotFound", err)
	}
	// Номер освобождён — по нему заводится новый аккаунт.
	fresh := registerUser(t, i, "+79990020010", "Заново", "", "web", "browser")
	if fresh.User.ID == userID {
		t.Fatal("новый вход по освобождённому номеру вернул старый аккаунт")
	}
}

// Почта к паролю привязана — сбрасывать нельзя: иначе знание номера и SMS-кода
// давало бы удаление чужого аккаунта в обход второго фактора. Аккаунт цел.
func TestResetAccount_RecoveryAvailable(t *testing.T) {
	ctx := context.Background()
	i, users, _, codes := newInteractor()

	userID, pwToken := twoFactorLogin(t, i, codes, "+79990020011", "denis@example.com")

	if err := i.ResetAccount(ctx, pwToken); !errors.Is(err, ErrRecoveryAvailable) {
		t.Fatalf("ResetAccount с почтой = %v, want ErrRecoveryAvailable", err)
	}
	u, err := users.GetByID(ctx, userID)
	if err != nil || u.Phone != "+79990020011" || u.DisplayName == "Deleted Account" {
		t.Fatalf("аккаунт пострадал при отказе: %+v, %v", u, err)
	}
	if st, err := i.PasswordState(ctx, userID); err != nil || !st.Enabled {
		t.Fatalf("облачный пароль снят при отказе: %+v, %v", st, err)
	}
	// Отказ не сжигает шаг пароля — пользователь возвращается к восстановлению.
	if _, err := i.RequestPasswordRecovery(ctx, pwToken); err != nil {
		t.Fatalf("восстановление после отказа: %v", err)
	}
}

// Истёкший / неизвестный password_token — ErrNotFound (401), ничего не удаляется.
func TestResetAccount_ExpiredToken(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	if err := i.ResetAccount(ctx, "неизвестный-токен"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("неизвестный токен = %v, want ErrNotFound", err)
	}
}
