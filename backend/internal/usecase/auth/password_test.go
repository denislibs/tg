package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Полный флоу облачного пароля: установка → вход в два шага → смена → снятие.
func TestCloudPasswordFlow(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()

	// первая регистрация без пароля — сразу сессия
	res := registerUser(t, i, "+79990001122", "Пароль", "", "dev", "test")
	if res.PasswordNeeded || res.Token == "" {
		t.Fatalf("plain sign up = %+v", res)
	}
	userID := res.User.ID

	// установить пароль
	if err := i.SetPassword(ctx, userID, "", "s3cret", "подсказка", "denis@example.com"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	st, err := i.PasswordState(ctx, userID)
	if err != nil || !st.Enabled || st.Hint != "подсказка" || st.Email != "d****@e******.com" {
		t.Fatalf("PasswordState = %+v, %v", st, err)
	}

	// смена без верного current — отказ
	if err := i.SetPassword(ctx, userID, "wrong", "new", "", ""); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("SetPassword wrong current = %v, want ErrBadPassword", err)
	}

	// вход теперь двухшаговый
	_ = codes.SaveCode(ctx, "+79990001122", "12345", time.Now().Add(time.Hour))
	res, err = i.SignIn(ctx, "+79990001122", "12345", "dev", "test")
	if err != nil || !res.PasswordNeeded || res.PasswordToken == "" || res.Hint != "подсказка" || res.Token != "" {
		t.Fatalf("2fa sign in = %+v, %v", res, err)
	}

	// неверный пароль — токен переживает попытку
	if _, err := i.CheckPassword(ctx, res.PasswordToken, "nope", "dev", "test"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("CheckPassword wrong = %v, want ErrBadPassword", err)
	}
	ok, err := i.CheckPassword(ctx, res.PasswordToken, "s3cret", "dev", "test")
	if err != nil || ok.Token == "" || ok.User.ID != userID {
		t.Fatalf("CheckPassword = %+v, %v", ok, err)
	}
	// токен одноразовый
	if _, err := i.CheckPassword(ctx, res.PasswordToken, "s3cret", "dev", "test"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("CheckPassword reuse = %v, want ErrNotFound", err)
	}

	// подсказка не может совпадать с паролем
	if err := i.SetPassword(ctx, userID, "s3cret", "abc", "abc", ""); err == nil {
		t.Fatal("hint == password must be rejected")
	}

	// снятие пароля
	if err := i.RemovePassword(ctx, userID, "wrong"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("RemovePassword wrong = %v", err)
	}
	if err := i.RemovePassword(ctx, userID, "s3cret"); err != nil {
		t.Fatalf("RemovePassword: %v", err)
	}
	st, _ = i.PasswordState(ctx, userID)
	if st.Enabled {
		t.Fatal("password still enabled after remove")
	}
}

// После maxPasswordAttempts неверных паролей password_token сжигается (анти-
// брутфорс облачного пароля), даже верный пароль потом не проходит.
func TestCloudPassword_AttemptCapBurnsToken(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()

	res := registerUser(t, i, "+79990002233", "Пароль", "", "dev", "test")
	userID := res.User.ID
	if err := i.SetPassword(ctx, userID, "", "s3cret", "hint", ""); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	_ = codes.SaveCode(ctx, "+79990002233", "12345", time.Now().Add(time.Hour))
	res, err := i.SignIn(ctx, "+79990002233", "12345", "dev", "test")
	if err != nil || !res.PasswordNeeded {
		t.Fatalf("2fa sign in = %+v, %v", res, err)
	}
	tok := res.PasswordToken

	// Первые maxPasswordAttempts-1 неудач — токен жив (ErrBadPassword).
	for n := 1; n < maxPasswordAttempts; n++ {
		if _, err := i.CheckPassword(ctx, tok, "nope", "dev", "test"); !errors.Is(err, domain.ErrBadPassword) {
			t.Fatalf("attempt %d = %v, want ErrBadPassword", n, err)
		}
	}
	// maxPasswordAttempts-я неудача сжигает токен → ErrNotFound.
	if _, err := i.CheckPassword(ctx, tok, "nope", "dev", "test"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("attempt %d = %v, want ErrNotFound (burned)", maxPasswordAttempts, err)
	}
	// Даже верный пароль после сжигания — ErrNotFound.
	if _, err := i.CheckPassword(ctx, tok, "s3cret", "dev", "test"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("after burn, correct pw = %v, want ErrNotFound", err)
	}
}

// Пароль не нормализуется (как в Telegram): пробелы по краям значимы. Раньше
// SetPassword резал их TrimSpace, а проверки — нет, и пароль « abc » после
// установки не проходил ни verify, ни вход, ни смену/снятие.
func TestCloudPassword_SpacesAreSignificant(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()

	res := registerUser(t, i, "+79990003344", "Пароль", "", "dev", "test")
	userID := res.User.ID
	if err := i.SetPassword(ctx, userID, "", " abc ", "", ""); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	if err := i.VerifyPassword(ctx, userID, " abc "); err != nil {
		t.Fatalf("VerifyPassword(как задан) = %v, want nil", err)
	}
	// Обрезанный вариант — другой пароль.
	if err := i.VerifyPassword(ctx, userID, "abc"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("VerifyPassword(обрезанный) = %v, want ErrBadPassword", err)
	}

	_ = codes.SaveCode(ctx, "+79990003344", "12345", time.Now().Add(time.Hour))
	res, err := i.SignIn(ctx, "+79990003344", "12345", "dev", "test")
	if err != nil || !res.PasswordNeeded {
		t.Fatalf("2fa sign in = %+v, %v", res, err)
	}
	if _, err := i.CheckPassword(ctx, res.PasswordToken, " abc ", "dev", "test"); err != nil {
		t.Fatalf("CheckPassword(как задан) = %v, want nil", err)
	}

	// Смена и снятие принимают текущий пароль как задан.
	if err := i.SetPassword(ctx, userID, " abc ", "  x y  ", "", ""); err != nil {
		t.Fatalf("SetPassword(смена) = %v", err)
	}
	if err := i.RemovePassword(ctx, userID, "  x y  "); err != nil {
		t.Fatalf("RemovePassword = %v", err)
	}
}

// Пустой и чисто пробельный новый пароль при выключенной 2FA отвергается;
// пробельный при включённой — тоже (это не «пустой = только hint/email»).
func TestCloudPassword_BlankRejected(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	res := registerUser(t, i, "+79990004455", "Пароль", "", "dev", "test")
	userID := res.User.ID
	for _, p := range []string{"", "   ", "\t\n"} {
		if err := i.SetPassword(ctx, userID, "", p, "", ""); err == nil {
			t.Fatalf("SetPassword(%q) без 2FA должен отвергаться", p)
		}
	}
	if err := i.SetPassword(ctx, userID, "", "s3cret", "", ""); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	if err := i.SetPassword(ctx, userID, "s3cret", "   ", "", ""); err == nil {
		t.Fatal("пробельный новый пароль при включённой 2FA должен отвергаться")
	}
	// Пустой новый при включённой — обновление только подсказки, пароль прежний.
	if err := i.SetPassword(ctx, userID, "s3cret", "", "новая", ""); err != nil {
		t.Fatalf("SetPassword(только hint) = %v", err)
	}
	if err := i.VerifyPassword(ctx, userID, "s3cret"); err != nil {
		t.Fatalf("пароль изменился при смене только hint: %v", err)
	}
}

// Совместимость: у тех, кто поставил « abc » до фикса, в базе хеш от «abc».
// Ввод как есть должен проходить (запасная проверка обрезанного варианта) во
// всех местах сверки: verify, вход, смена, снятие.
func TestCloudPassword_LegacyTrimmedHash(t *testing.T) {
	ctx := context.Background()
	i, _, _, codes := newInteractor()

	res := registerUser(t, i, "+79990005566", "Пароль", "", "dev", "test")
	userID := res.User.ID
	seedLegacy := func() {
		t.Helper()
		h, err := domain.HashPassword("abc") // так старый SetPassword сохранял « abc »
		if err != nil {
			t.Fatal(err)
		}
		if err := i.pw.SetPassword(ctx, userID, &h, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	seedLegacy()

	if err := i.VerifyPassword(ctx, userID, " abc "); err != nil {
		t.Fatalf("VerifyPassword(legacy « abc ») = %v, want nil", err)
	}
	if err := i.VerifyPassword(ctx, userID, "abc"); err != nil {
		t.Fatalf("VerifyPassword(legacy «abc») = %v, want nil", err)
	}
	if err := i.VerifyPassword(ctx, userID, " abd "); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("VerifyPassword(чужой) = %v, want ErrBadPassword", err)
	}

	_ = codes.SaveCode(ctx, "+79990005566", "12345", time.Now().Add(time.Hour))
	res, err := i.SignIn(ctx, "+79990005566", "12345", "dev", "test")
	if err != nil || !res.PasswordNeeded {
		t.Fatalf("2fa sign in = %+v, %v", res, err)
	}
	if _, err := i.CheckPassword(ctx, res.PasswordToken, " abc ", "dev", "test"); err != nil {
		t.Fatalf("CheckPassword(legacy) = %v, want nil", err)
	}

	if err := i.SetPassword(ctx, userID, " abc ", "new", "", ""); err != nil {
		t.Fatalf("SetPassword(current legacy) = %v", err)
	}
	seedLegacy()
	if err := i.RemovePassword(ctx, userID, " abc "); err != nil {
		t.Fatalf("RemovePassword(legacy) = %v", err)
	}
}
