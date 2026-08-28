package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Незнакомый номер не заводит пользователя молча: SignIn отдаёт шаг регистрации,
// аккаунт появляется только после SignUp.
func TestSignUp_NewPhoneFlow(t *testing.T) {
	ctx := context.Background()
	i, users, _, codes := newInteractor()

	_ = i.RequestCode(ctx, "+79990010001")
	step, err := i.SignIn(ctx, "+79990010001", "12345", "web", "browser")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	if !step.SignUpRequired || step.SignUpToken == "" || step.Token != "" || step.User.ID != 0 {
		t.Fatalf("SignIn нового номера = %+v", step)
	}
	if _, ok := users.byPhone["+79990010001"]; ok {
		t.Fatal("пользователь создан до регистрации")
	}
	// Код сгорает вместе с выдачей токена регистрации.
	if _, err := codes.GetCode(ctx, "+79990010001"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("код должен быть погашен, got %v", err)
	}

	res, err := i.SignUp(ctx, step.SignUpToken, " Денис ", " Уревич ", "web", "browser")
	if err != nil {
		t.Fatalf("SignUp: %v", err)
	}
	if res.Token == "" || res.User.ID == 0 {
		t.Fatalf("SignUp вернул пустую сессию: %+v", res)
	}
	if res.User.FirstName != "Денис" || res.User.LastName != "Уревич" {
		t.Fatalf("имя не сохранено: %+v", res.User)
	}
	if got, _, err := i.Authenticate(ctx, res.Token); err != nil || got.ID != res.User.ID {
		t.Fatalf("Authenticate = %+v, %v", got, err)
	}

	// Токен одноразовый.
	if _, err := i.SignUp(ctx, step.SignUpToken, "Ещё", "", "web", "browser"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("повторный SignUp = %v, want ErrNotFound", err)
	}
	// Знакомый номер входит без шага регистрации.
	_ = i.RequestCode(ctx, "+79990010001")
	again, err := i.SignIn(ctx, "+79990010001", "12345", "web", "browser")
	if err != nil || again.SignUpRequired || again.Token == "" || again.User.ID != res.User.ID {
		t.Fatalf("повторный вход = %+v, %v", again, err)
	}
}

// Отказы шага регистрации: чужой/протухший токен, пустое и слишком длинное имя.
func TestSignUp_Rejections(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	if _, err := i.SignUp(ctx, "deadbeef", "Денис", "", "web", "browser"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("неизвестный токен = %v, want ErrNotFound", err)
	}

	_ = i.RequestCode(ctx, "+79990010002")
	step, _ := i.SignIn(ctx, "+79990010002", "12345", "web", "browser")

	if _, err := i.SignUp(ctx, step.SignUpToken, "   ", "", "web", "browser"); !errors.Is(err, ErrNameRequired) {
		t.Fatalf("пустое имя = %v, want ErrNameRequired", err)
	}
	if _, err := i.SignUp(ctx, step.SignUpToken, strings.Repeat("я", maxFirstNameLen+1), "", "web", "browser"); !errors.Is(err, domain.ErrTooLong) {
		t.Fatalf("длинное имя = %v, want ErrTooLong", err)
	}
	if _, err := i.SignUp(ctx, step.SignUpToken, "Денис", strings.Repeat("я", maxLastNameLen+1), "web", "browser"); !errors.Is(err, domain.ErrTooLong) {
		t.Fatalf("длинная фамилия = %v, want ErrTooLong", err)
	}
	// Отказы токен не сжигают — опечатка в имени не гонит на новый OTP.
	if _, err := i.SignUp(ctx, step.SignUpToken, "Денис", "", "web", "browser"); err != nil {
		t.Fatalf("SignUp после отказов: %v", err)
	}
}

// Протухший токен регистрации не принимается.
func TestSignUp_ExpiredToken(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	steps := newFakeStepRepo()
	i.steps = steps

	_ = i.RequestCode(ctx, "+79990010003")
	step, _ := i.SignIn(ctx, "+79990010003", "12345", "web", "browser")

	// Отматываем срок назад — как будто прошло больше signUpTokenTTL.
	hash := domain.HashToken(step.SignUpToken)
	_ = steps.SaveSignUpToken(ctx, hash, "+79990010003", time.Now().Add(-time.Minute))

	if _, err := i.SignUp(ctx, step.SignUpToken, "Денис", "", "web", "browser"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("протухший токен = %v, want ErrNotFound", err)
	}
}

// Номер заняли между шагами: регистрация отбивается конфликтом, токен сгорает.
func TestSignUp_PhoneOccupiedBetweenSteps(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	_ = i.RequestCode(ctx, "+79990010004")
	step, _ := i.SignIn(ctx, "+79990010004", "12345", "web", "browser")

	// Тот же номер регистрируется параллельно (второй токен шага).
	_ = i.RequestCode(ctx, "+79990010004")
	other, _ := i.SignIn(ctx, "+79990010004", "12345", "web", "browser")
	if _, err := i.SignUp(ctx, other.SignUpToken, "Первый", "", "web", "browser"); err != nil {
		t.Fatalf("первая регистрация: %v", err)
	}

	if _, err := i.SignUp(ctx, step.SignUpToken, "Второй", "", "web", "browser"); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("занятый номер = %v, want ErrConflict", err)
	}
	if _, err := i.SignUp(ctx, step.SignUpToken, "Второй", "", "web", "browser"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("токен должен был сгореть, got %v", err)
	}
}
