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
	res := registerUser(t, i, phone, "Восстановление", "", "dev", "test")
	if err := i.SetPassword(context.Background(), res.User.ID, "", "s3cret", "hint", email); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	return res.User.ID, passwordStep(t, i, codes, phone)
}

// passwordStep проходит вход по SMS-коду до шага облачного пароля и возвращает
// свежий password_token. Сессии этот шаг НЕ выдаёт — ровно то, что доступно
// злоумышленнику, знающему номер и перехватившему код.
func passwordStep(t *testing.T, i *Interactor, codes *fakeCodeRepo, phone string) string {
	t.Helper()
	ctx := context.Background()
	_ = codes.SaveCode(ctx, phone, "12345", time.Now().Add(time.Hour))
	step, err := i.SignIn(ctx, phone, "12345", "dev", "test")
	if err != nil || !step.PasswordNeeded {
		t.Fatalf("2fa sign in = %+v, %v", step, err)
	}
	return step.PasswordToken
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

// setReset подменяет запись отложенного сброса целиком: тесты «доживают» до
// нужного момента, а не ждут неделю. Нулевой cancelledAt — сброс ждёт исполнения.
func setReset(t *testing.T, i *Interactor, userID int64, deleteAt, cancelledAt time.Time) {
	t.Helper()
	steps, ok := i.steps.(*fakeStepRepo)
	if !ok {
		t.Fatalf("steps = %T, ожидался fakeStepRepo", i.steps)
	}
	if _, ok := steps.resets[userID]; !ok {
		t.Fatalf("отложенного сброса для user=%d нет", userID)
	}
	steps.resets[userID] = struct {
		requestedAt time.Time
		deleteAt    time.Time
		cancelledAt time.Time
	}{requestedAt: deleteAt.Add(-defaultAccountResetWindow), deleteAt: deleteAt, cancelledAt: cancelledAt}
}

// resetDeadline — срок исполнения запланированного сброса (для проверки, что
// повторные запросы его не двигают).
func resetDeadline(t *testing.T, i *Interactor, userID int64) time.Time {
	t.Helper()
	deleteAt, _, err := i.steps.AccountReset(context.Background(), userID)
	if err != nil {
		t.Fatalf("AccountReset(user=%d): %v", userID, err)
	}
	return deleteAt
}

// Восстановление невозможно (почта не привязана) → сброс аккаунта: единственный
// выход в Telegram, tweb зовёт account.deleteAccount после PASSWORD_RECOVERY_NA.
// Но удаление НЕ мгновенное: первый запрос только планирует его через неделю
// (2FA_CONFIRM_WAIT_<секунды>), аккаунт при этом остаётся цел.
func TestResetAccount_SchedulesAndWaits(t *testing.T) {
	ctx := context.Background()
	i, users, _, codes := newInteractor()

	userID, pwToken := twoFactorLogin(t, i, codes, "+79990020010", "")

	retryAfter, err := i.ResetAccount(ctx, pwToken)
	if !errors.Is(err, ErrResetPending) {
		t.Fatalf("первый сброс = %v, want ErrResetPending", err)
	}
	if want := int(defaultAccountResetWindow / time.Second); retryAfter > want || retryAfter < want-5 {
		t.Fatalf("retry_after = %d, ожидалось около %d (неделя)", retryAfter, want)
	}
	// Аккаунт цел: сессии, номер, облачный пароль на месте.
	if u, err := users.GetByID(ctx, userID); err != nil || u.Phone != "+79990020010" || u.Deleted {
		t.Fatalf("аккаунт пострадал при планировании: %+v, %v", u, err)
	}
	if sessions, _ := i.ListSessions(ctx, userID); len(sessions) == 0 {
		t.Fatal("сессии отозваны на этапе планирования")
	}
	if st, err := i.PasswordState(ctx, userID); err != nil || !st.Enabled {
		t.Fatalf("облачный пароль снят на этапе планирования: %+v, %v", st, err)
	}

	// Повтор внутри окна не создаёт новую запись: срок исполнения тот же, а
	// значит окно нельзя ни продлить, ни обнулить чередой запросов.
	deadline := resetDeadline(t, i, userID)
	again, err := i.ResetAccount(ctx, pwToken)
	if !errors.Is(err, ErrResetPending) {
		t.Fatalf("повтор внутри окна = %v, want ErrResetPending", err)
	}
	if !resetDeadline(t, i, userID).Equal(deadline) {
		t.Fatal("повторный запрос сдвинул срок исполнения сброса")
	}
	if again > retryAfter {
		t.Fatalf("остаток вырос: было %d, стало %d", retryAfter, again)
	}
	// Шаг пароля не сгорел — клиент возвращается к нему с тем же токеном.
	if _, err := i.ResetAccount(ctx, pwToken); !errors.Is(err, ErrResetPending) {
		t.Fatalf("третий запрос = %v, want ErrResetPending", err)
	}
}

// Окно истекло — повторный вызов ручки действительно удаляет аккаунт: фонового
// задания нет, исполняет сам запрос. Аккаунт анонимизируется, номер
// освобождается, все сессии отзываются, шаг пароля сгорает.
func TestResetAccount_ExecutesAfterWindow(t *testing.T) {
	ctx := context.Background()
	i, users, _, codes := newInteractor()
	cache := newFakeCache()
	rev := &fakeRevoker{}
	i.SetCache(cache)
	i.SetRevocationNotifier(rev)

	userID, pwToken := twoFactorLogin(t, i, codes, "+79990020012", "")
	// Сессия, выданная до включения 2FA, должна быть отозвана вместе с аккаунтом.
	if sessions, _ := i.ListSessions(ctx, userID); len(sessions) == 0 {
		t.Fatal("нет активных сессий до сброса — тест бессмысленен")
	}
	if _, err := i.ResetAccount(ctx, pwToken); !errors.Is(err, ErrResetPending) {
		t.Fatalf("планирование = %v, want ErrResetPending", err)
	}
	// Окно подменяем, а не ждём.
	setReset(t, i, userID, time.Now().Add(-time.Second), time.Time{})

	if retryAfter, err := i.ResetAccount(ctx, pwToken); err != nil || retryAfter != 0 {
		t.Fatalf("исполнение сброса = %d, %v", retryAfter, err)
	}

	u, err := users.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID после сброса: %v", err)
	}
	if u.Phone != "" || !u.Deleted {
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
	// Запись отложенного сброса исполнена и убрана.
	if _, _, err := i.steps.AccountReset(ctx, userID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("запись сброса пережила исполнение: %v", err)
	}
	// Токен шага пароля одноразовый.
	if _, err := i.ResetAccount(ctx, pwToken); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("повторный сброс = %v, want ErrNotFound", err)
	}
	// Номер освобождён — по нему заводится новый аккаунт.
	fresh := registerUser(t, i, "+79990020012", "Заново", "", "web", "browser")
	if fresh.User.ID == userID {
		t.Fatal("новый вход по освобождённому номеру вернул старый аккаунт")
	}
}

// Владелец зашёл за время окна — сброс снимается (2FA_RECENT_CONFIRM). Вход по
// одному лишь SMS-коду отменой НЕ считается: он останавливается на шаге пароля и
// сессии не выдаёт, а значит доступен и тому, кто перехватил код.
func TestResetAccount_CancelledByOwnerLogin(t *testing.T) {
	ctx := context.Background()
	i, users, _, codes := newInteractor()

	userID, pwToken := twoFactorLogin(t, i, codes, "+79990020013", "")
	if _, err := i.ResetAccount(ctx, pwToken); !errors.Is(err, ErrResetPending) {
		t.Fatalf("планирование = %v, want ErrResetPending", err)
	}

	// Ещё один вход по SMS-коду: второй фактор не пройден — сброс всё ещё в силе.
	smsToken := passwordStep(t, i, codes, "+79990020013")
	if _, err := i.ResetAccount(ctx, smsToken); !errors.Is(err, ErrResetPending) {
		t.Fatalf("после входа по SMS-коду = %v, want ErrResetPending (код не отменяет сброс)", err)
	}

	// Владелец вводит облачный пароль — вот это отмена.
	if res, err := i.CheckPassword(ctx, smsToken, "s3cret", "dev", "test"); err != nil || res.Token == "" {
		t.Fatalf("CheckPassword владельца = %+v, %v", res, err)
	}
	ownerToken := passwordStep(t, i, codes, "+79990020013")
	if _, err := i.ResetAccount(ctx, ownerToken); !errors.Is(err, ErrResetRecentConfirm) {
		t.Fatalf("после входа владельца = %v, want ErrResetRecentConfirm", err)
	}

	// Отмена сильнее истёкшего срока: дозревшая, но снятая запись не удаляет
	// аккаунт.
	setReset(t, i, userID, time.Now().Add(-time.Hour), time.Now().Add(-time.Minute))
	if _, err := i.ResetAccount(ctx, ownerToken); !errors.Is(err, ErrResetRecentConfirm) {
		t.Fatalf("снятый, но дозревший сброс = %v, want ErrResetRecentConfirm", err)
	}
	if u, err := users.GetByID(ctx, userID); err != nil || u.Phone != "+79990020013" {
		t.Fatalf("аккаунт удалён отменённым сбросом: %+v, %v", u, err)
	}

	// Карантин выдержан — заказ разрешён заново, и с полным окном.
	setReset(t, i, userID, time.Now().Add(-time.Hour), time.Now().Add(-defaultAccountResetWindow-time.Minute))
	retryAfter, err := i.ResetAccount(ctx, ownerToken)
	if !errors.Is(err, ErrResetPending) {
		t.Fatalf("после карантина = %v, want ErrResetPending", err)
	}
	if want := int(defaultAccountResetWindow / time.Second); retryAfter > want || retryAfter < want-5 {
		t.Fatalf("новое окно = %d с, ожидалось около %d", retryAfter, want)
	}
}

// Подтверждение QR-кода — единственная выдача сессии мимо mintSession, и она
// тоже снимает сброс: подтвердить может только уже вошедший владелец.
func TestResetAccount_CancelledByQRConfirm(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()
	i.SetQRStore(newFakeQRStoreTTL())

	userID, pwToken := twoFactorLogin(t, i, codes, "+79990020014", "")
	if _, err := i.ResetAccount(ctx, pwToken); !errors.Is(err, ErrResetPending) {
		t.Fatalf("планирование = %v, want ErrResetPending", err)
	}

	owner, err := i.users.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	qrToken, _, err := i.NewQRLogin(ctx, "web")
	if err != nil {
		t.Fatalf("NewQRLogin: %v", err)
	}
	if err := i.ConfirmQRLogin(ctx, qrToken, owner); err != nil {
		t.Fatalf("ConfirmQRLogin: %v", err)
	}
	if _, err := i.ResetAccount(ctx, pwToken); !errors.Is(err, ErrResetRecentConfirm) {
		t.Fatalf("после подтверждения QR = %v, want ErrResetRecentConfirm", err)
	}
}

// Почта к паролю привязана — сбрасывать нельзя: иначе знание номера и SMS-кода
// давало бы удаление чужого аккаунта в обход второго фактора. Аккаунт цел,
// отложенный сброс не заводится.
func TestResetAccount_RecoveryAvailable(t *testing.T) {
	ctx := context.Background()
	i, users, _, codes := newInteractor()

	userID, pwToken := twoFactorLogin(t, i, codes, "+79990020011", "denis@example.com")

	if _, err := i.ResetAccount(ctx, pwToken); !errors.Is(err, ErrRecoveryAvailable) {
		t.Fatalf("ResetAccount с почтой = %v, want ErrRecoveryAvailable", err)
	}
	if _, _, err := i.steps.AccountReset(ctx, userID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("сброс запланирован вопреки отказу: %v", err)
	}
	u, err := users.GetByID(ctx, userID)
	if err != nil || u.Phone != "+79990020011" || u.Deleted {
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

// Истёкший / неизвестный password_token — ErrNotFound (401), ничего не
// удаляется и не планируется.
func TestResetAccount_ExpiredToken(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	if _, err := i.ResetAccount(ctx, "неизвестный-токен"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("неизвестный токен = %v, want ErrNotFound", err)
	}
}
