package auth

import (
	"context"
	"errors"
	"testing"
)

// Вход по ключу доступа при включённом облачном пароле — шаг пароля, а не
// сессия (tweb passkeyLoginButton.tsx:63-71: SESSION_PASSWORD_NEEDED → карточка
// пароля). Раньше MintPasskeySession выдавал сессию в обход пароля (Б-2).
func TestPasskeySignIn_PasswordEnabled_ReturnsPasswordStep(t *testing.T) {
	ctx := context.Background()
	i, _, devices, _ := newInteractor()
	reg := registerUser(t, i, "+79990004455", "Кот", "", "dev", "test")
	userID := reg.User.ID
	if err := i.SetPassword(ctx, userID, "", "s3cret", "кот", ""); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	before := len(devices.byID)

	res, err := i.PasskeySignIn(ctx, userID, "Chrome", "web")
	if err != nil {
		t.Fatalf("PasskeySignIn: %v", err)
	}
	if !res.PasswordNeeded || res.PasswordToken == "" || res.Hint != "кот" {
		t.Fatalf("res = %+v, ожидался шаг пароля с подсказкой", res)
	}
	if res.Token != "" {
		t.Fatal("сессия выдана в обход облачного пароля")
	}
	if len(devices.byID) != before {
		t.Fatalf("сессий было %d, стало %d: devices.Create не должен вызываться", before, len(devices.byID))
	}

	// Шаг пароля — тот же общий CheckPassword: верный пароль выдаёт сессию.
	ok, err := i.CheckPassword(ctx, res.PasswordToken, "s3cret", "Chrome", "web")
	if err != nil || ok.Token == "" || ok.User.ID != userID {
		t.Fatalf("CheckPassword = %+v, %v", ok, err)
	}
}

func TestPasskeySignIn_NoPassword_MintsSession(t *testing.T) {
	ctx := context.Background()
	i, _, devices, _ := newInteractor()
	reg := registerUser(t, i, "+79990004466", "Пёс", "", "dev", "test")
	before := len(devices.byID)

	res, err := i.PasskeySignIn(ctx, reg.User.ID, "Chrome", "web")
	if err != nil {
		t.Fatalf("PasskeySignIn: %v", err)
	}
	if res.PasswordNeeded || res.Token == "" || res.User.ID != reg.User.ID {
		t.Fatalf("res = %+v, ожидалась сессия", res)
	}
	if len(devices.byID) != before+1 {
		t.Fatalf("сессий было %d, стало %d: ожидалась ровно одна новая", before, len(devices.byID))
	}
}

// failingPasswordRepo — чтение пароля падает (сбой БД).
type failingPasswordRepo struct{ *fakePasswordRepo }

func (failingPasswordRepo) Password(context.Context, int64) (*string, string, string, error) {
	return nil, "", "", errors.New("db")
}

// Сбой чтения пароля — не «пароля нет»: закрываемся, сессия не выдаётся.
func TestPasskeySignIn_PasswordReadError_NoSession(t *testing.T) {
	ctx := context.Background()
	users := newFakeUserRepo()
	devices := newFakeDeviceRepo(users)
	i := New(users, devices, newFakeCodeRepo(), failingPasswordRepo{newFakePasswordRepo()},
		newFakeStepRepo(), "12345", func(string, ...any) {})
	reg := registerUser(t, i, "+79990004477", "Лис", "", "dev", "test")
	before := len(devices.byID)

	if _, err := i.PasskeySignIn(ctx, reg.User.ID, "Chrome", "web"); err == nil {
		t.Fatal("ожидалась ошибка чтения пароля")
	}
	if len(devices.byID) != before {
		t.Fatal("сессия выдана при сбое чтения пароля")
	}
}
