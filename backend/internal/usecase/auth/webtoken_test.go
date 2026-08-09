package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Веб-токен: выпуск авторизованным пользователем → обмен на сессию → токен мёртв.
func TestSignImport_Flow(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	owner := registerUser(t, i, "+79990030001", "Импорт", "", "web", "browser")

	token, expiresAt, err := i.NewWebAuthToken(ctx, owner.User.ID)
	if err != nil {
		t.Fatalf("NewWebAuthToken: %v", err)
	}
	if token == "" || !expiresAt.After(time.Now()) {
		t.Fatalf("выпуск токена = %q, %v", token, expiresAt)
	}

	res, err := i.SignImport(ctx, token, "desktop", "web")
	if err != nil {
		t.Fatalf("SignImport: %v", err)
	}
	if res.Token == "" || res.User.ID != owner.User.ID || res.Token == owner.Token {
		t.Fatalf("SignImport = %+v", res)
	}
	if got, _, err := i.Authenticate(ctx, res.Token); err != nil || got.ID != owner.User.ID {
		t.Fatalf("Authenticate = %+v, %v", got, err)
	}

	// Одноразовость.
	if _, err := i.SignImport(ctx, token, "desktop", "web"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("повторный обмен = %v, want ErrNotFound", err)
	}
	// Чужой токен.
	if _, err := i.SignImport(ctx, "deadbeef", "desktop", "web"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("неизвестный токен = %v, want ErrNotFound", err)
	}
}

// Протухший веб-токен не принимается.
func TestSignImport_ExpiredToken(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	steps := newFakeStepRepo()
	i.steps = steps

	owner := registerUser(t, i, "+79990030002", "Импорт", "", "web", "browser")
	token, _, err := i.NewWebAuthToken(ctx, owner.User.ID)
	if err != nil {
		t.Fatalf("NewWebAuthToken: %v", err)
	}
	_ = steps.SaveWebAuthToken(ctx, domain.HashToken(token), owner.User.ID, time.Now().Add(-time.Minute))

	if _, err := i.SignImport(ctx, token, "desktop", "web"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("протухший токен = %v, want ErrNotFound", err)
	}
}

// При включённом облачном пароле обмен даёт не сессию, а шаг пароля (tweb
// SignImportCard → SESSION_PASSWORD_NEEDED → карточка пароля).
func TestSignImport_PasswordNeeded(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()

	owner := registerUser(t, i, "+79990030003", "Импорт", "", "web", "browser")
	if err := i.SetPassword(ctx, owner.User.ID, "", "s3cret", "hint", ""); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	token, _, err := i.NewWebAuthToken(ctx, owner.User.ID)
	if err != nil {
		t.Fatalf("NewWebAuthToken: %v", err)
	}

	res, err := i.SignImport(ctx, token, "desktop", "web")
	if err != nil {
		t.Fatalf("SignImport: %v", err)
	}
	if !res.PasswordNeeded || res.PasswordToken == "" || res.Token != "" || res.Hint != "hint" {
		t.Fatalf("SignImport с паролем = %+v", res)
	}
	// Веб-токен сгорел, вход продолжается по password_token.
	if _, err := i.SignImport(ctx, token, "desktop", "web"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("веб-токен должен был сгореть, got %v", err)
	}
	done, err := i.CheckPassword(ctx, res.PasswordToken, "s3cret", "desktop", "web")
	if err != nil || done.Token == "" || done.User.ID != owner.User.ID {
		t.Fatalf("CheckPassword = %+v, %v", done, err)
	}
}

// Без хранилища шагов входа ветки регистрации/восстановления/импорта отключены.
func TestLoginSteps_Unavailable(t *testing.T) {
	ctx := context.Background()
	users := newFakeUserRepo()
	i := New(users, newFakeDeviceRepo(users), newFakeCodeRepo(), newFakePasswordRepo(), nil, "12345", func(string, ...any) {})

	if _, err := i.SignUp(ctx, "tok", "Денис", "", "web", "browser"); !errors.Is(err, ErrLoginStepsUnavailable) {
		t.Fatalf("SignUp = %v, want ErrLoginStepsUnavailable", err)
	}
	if _, err := i.RequestPasswordRecovery(ctx, "tok"); !errors.Is(err, ErrLoginStepsUnavailable) {
		t.Fatalf("RequestPasswordRecovery = %v, want ErrLoginStepsUnavailable", err)
	}
	if _, err := i.SignImport(ctx, "tok", "web", "browser"); !errors.Is(err, ErrLoginStepsUnavailable) {
		t.Fatalf("SignImport = %v, want ErrLoginStepsUnavailable", err)
	}
	if _, _, err := i.NewWebAuthToken(ctx, 1); !errors.Is(err, ErrLoginStepsUnavailable) {
		t.Fatalf("NewWebAuthToken = %v, want ErrLoginStepsUnavailable", err)
	}
}
