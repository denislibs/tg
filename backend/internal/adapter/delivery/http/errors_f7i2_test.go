package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Ф7-И2 (MC-08, ч. 2 и 5): отказы входа и имён — имена TG, которые tweb
// 812502980 разбирает по `err.type`, все 400 (план 2026-10-12-f7, Task 10).

// postJSONFrom — POST с явным IP клиента: у каждого кейса своё ведро лимитера.
func postJSONFrom(t *testing.T, h http.Handler, ip, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, path, bytes.NewReader(buf))
	req.Header.Set("X-Real-IP", ip)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// wantWire — статус и текст конструктора error{code, text}.
func wantWire(t *testing.T, rec *httptest.ResponseRecorder, status int, text, what string) {
	t.Helper()
	if e := wireErrorOf(rec); rec.Code != status || e.Text != text || e.Code != status {
		t.Fatalf("%s = %d %s; want %d %s", what, rec.Code, rec.Body.String(), status, text)
	}
}

// PHONE_NUMBER_INVALID (tweb SignInCard.tsx:136-141): пустой номер и номер без
// цифр — 400, раньше 400 `phone is required` и 500 `could not request code`.
// Проверка формы стоит ДО лимитера: мусор ведро не тратит и 420 не получает.
func TestRequestCode_PhoneNumberInvalid_HTTP(t *testing.T) {
	h := newTestRouter(t)
	for _, phone := range []string{"", "abc", "+", " + "} {
		rec := postJSONFrom(t, h, "198.51.100.10", "/auth/request_code", map[string]string{"phone": phone})
		wantWire(t, rec, http.StatusBadRequest, "PHONE_NUMBER_INVALID", "request_code "+phone)
	}
	// Четыре `abc` подряд с одного IP — четыре 400, не 420 (ведро otp-ip
	// burst 5 вместе с запросами выше уже исчерпалось бы).
	for n := 0; n < 4; n++ {
		rec := postJSONFrom(t, h, "198.51.100.10", "/auth/request_code", map[string]string{"phone": "abc"})
		wantWire(t, rec, http.StatusBadRequest, "PHONE_NUMBER_INVALID", "abc #"+itoa(int64(n)))
	}
	// Тот же IP по-прежнему может запросить код на настоящий номер.
	if rec := postJSONFrom(t, h, "198.51.100.10", "/auth/request_code", map[string]string{"phone": "+79990180001"}); rec.Code != http.StatusOK {
		t.Fatalf("валидный номер после мусора: %d %s", rec.Code, rec.Body.String())
	}
}

// Ключ `otp-phone:` — только цифры номера: «+7999…» и «7999…» — одно ведро
// (burst 3), а не два.
func TestRequestCode_PhoneBucketDigitsOnly_HTTP(t *testing.T) {
	h := newTestRouter(t)
	forms := []string{"+79990180002", "79990180002", "+7 999 018-00-02"}
	for i, phone := range forms {
		ip := "198.51.100." + itoa(int64(20+i)) // разные IP: ведро otp-ip не мешает
		if rec := postJSONFrom(t, h, ip, "/auth/request_code", map[string]string{"phone": phone}); rec.Code != http.StatusOK {
			t.Fatalf("запрос %d (%s): %d %s", i, phone, rec.Code, rec.Body.String())
		}
	}
	rec := postJSONFrom(t, h, "198.51.100.30", "/auth/request_code", map[string]string{"phone": "79990180002"})
	if rec.Code != 420 || !floodWaitRe.MatchString(wireErrorOf(rec).Text) {
		t.Fatalf("4-й запрос того же номера в другой записи = %d %s; want 420 FLOOD_WAIT_N", rec.Code, rec.Body.String())
	}
}

// PHONE_CODE_EMPTY (tweb AuthCodeCard.tsx:253-255): пустой код — отказ ручки
// до usecase; код верный, но пустой ответ не тратит попытку и не отдаёт
// PHONE_CODE_INVALID.
func TestSignIn_CodeEmpty_HTTP(t *testing.T) {
	h := newTestRouter(t)
	_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79990180003"})
	for _, code := range []string{"", "   "} {
		rec := postJSON(t, h, "/auth/sign_in", map[string]string{"phone": "+79990180003", "code": code})
		wantWire(t, rec, http.StatusBadRequest, "PHONE_CODE_EMPTY", "sign_in code="+code)
	}
	// Код после пустых попыток жив — usecase их не видел.
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{"phone": "+79990180003", "code": "12345"})
	if rec.Code != http.StatusOK {
		t.Fatalf("верный код после пустых: %d %s", rec.Code, rec.Body.String())
	}
}

// FIRSTNAME_INVALID / LASTNAME_INVALID / PHONE_NUMBER_OCCUPIED (tweb
// SignUpCard.tsx:121-127 пишет err.type в кнопку; В-М12).
func TestSignUp_NameAndOccupied_HTTP(t *testing.T) {
	h := newTestRouter(t)
	signUpStep := func(phone string) string {
		t.Helper()
		_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": phone})
		step := decodeSignIn(t, postJSON(t, h, "/auth/sign_in", map[string]string{"phone": phone, "code": "12345"}))
		if step.SignUpToken == "" {
			t.Fatalf("нет signup_token для %s", phone)
		}
		return step.SignUpToken
	}
	tok := signUpStep("+79990180004")
	rec := postJSON(t, h, "/auth/sign_up", map[string]string{"signup_token": tok, "first_name": strings.Repeat("я", 71)})
	wantWire(t, rec, http.StatusBadRequest, "FIRSTNAME_INVALID", "длинное имя")
	rec = postJSON(t, h, "/auth/sign_up", map[string]string{"signup_token": tok, "first_name": "Денис", "last_name": strings.Repeat("я", 65)})
	wantWire(t, rec, http.StatusBadRequest, "LASTNAME_INVALID", "длинная фамилия")

	// Номер заняли между шагами: два токена регистрации одного номера, первый
	// регистрирует, второй получает отказ.
	tokA := signUpStep("+79990180005")
	tokB := signUpStep("+79990180005")
	if rec := postJSON(t, h, "/auth/sign_up", map[string]string{"signup_token": tokA, "first_name": "А"}); rec.Code != http.StatusOK {
		t.Fatalf("первая регистрация: %d %s", rec.Code, rec.Body.String())
	}
	rec = postJSON(t, h, "/auth/sign_up", map[string]string{"signup_token": tokB, "first_name": "Б"})
	wantWire(t, rec, http.StatusBadRequest, "PHONE_NUMBER_OCCUPIED", "номер занят")
}

// Восстановление и облачный пароль на входе: PASSWORD_RECOVERY_NA (global.d.ts:267),
// EMAIL_HASH_EXPIRED (emailConfirmation.tsx:82; В-М13), PASSWORD_HASH_INVALID
// (PasswordCard.tsx:175-183).
func TestLoginPasswordErrors_HTTP(t *testing.T) {
	h := newTestRouter(t)
	token, _ := loginViaHTTP(t, h, "+79990180006")
	enableCloudPassword(t, h, token, "") // без почты — восстанавливать нечем
	pwToken := passwordStep(t, h, "+79990180006")

	rec := postJSON(t, h, "/auth/password/recover", map[string]string{"password_token": pwToken})
	wantWire(t, rec, http.StatusBadRequest, "PASSWORD_RECOVERY_NA", "recover без почты")

	rec = postJSON(t, h, "/auth/check_password", map[string]string{"password_token": pwToken, "password": "неверный"})
	wantWire(t, rec, http.StatusBadRequest, "PASSWORD_HASH_INVALID", "check_password неверный")

	// Кода восстановления под токеном нет (протух/исчерпан) — EMAIL_HASH_EXPIRED.
	rec = postJSON(t, h, "/auth/password/recover/confirm", map[string]string{"password_token": pwToken, "code": "012345"})
	wantWire(t, rec, http.StatusBadRequest, "EMAIL_HASH_EXPIRED", "recover/confirm без кода")
}

// /me/password*: неверный пароль — 400 PASSWORD_HASH_INVALID (tweb
// popups/password.tsx:38), раньше 403 `invalid password`.
func TestMePassword_HashInvalid_HTTP(t *testing.T) {
	e := newPwEnv(t, "+79990180007")
	wantWire(t, e.verify(t, 1, "192.0.2.71", "неверный"), http.StatusBadRequest, "PASSWORD_HASH_INVALID", "verify")
	rec := e.call(t, e.h.Set, e.userID, 1, "192.0.2.72", map[string]string{"current_password": "неверный", "new_password": "x", "hint": ""})
	wantWire(t, rec, http.StatusBadRequest, "PASSWORD_HASH_INVALID", "set")
	rec = e.call(t, e.h.Remove, e.userID, 1, "192.0.2.73", map[string]string{"current_password": "неверный"})
	wantWire(t, rec, http.StatusBadRequest, "PASSWORD_HASH_INVALID", "remove")
}

// `account.deleteAccount{reason}` (tweb appAccountManager.ts:481, PasswordCard.tsx:89):
// тело с `reason` принимается, исход прежний.
func TestAccountReset_AcceptsReason_HTTP(t *testing.T) {
	h := newTestRouter(t)
	token, _ := loginViaHTTP(t, h, "+79990180008")
	enableCloudPassword(t, h, token, "")
	pwToken := passwordStep(t, h, "+79990180008")
	rec := postJSON(t, h, "/auth/account/reset", map[string]string{"password_token": pwToken, "reason": "Forgot password"})
	if e := wireErrorOf(rec); rec.Code != http.StatusBadRequest || !strings.HasPrefix(e.Text, "2FA_CONFIRM_WAIT_") || waitSeconds(e.Text) <= 0 {
		t.Fatalf("reset с reason = %d %s; want 400 2FA_CONFIRM_WAIT_<N>", rec.Code, rec.Body.String())
	}
}

// PINNED_DIALOGS_TOO_MUCH (tweb components/showPinLimitReached.ts:18): шестой
// закреп при лимите 5.
func TestSetPin_Limit_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	token, _ := signUp(t, h, pool, "+79990180009")
	var peers []string
	for n := 0; n < 6; n++ {
		rec := authedReq(t, h, http.MethodPost, "/groups", token, map[string]any{"title": "G" + itoa(int64(n))})
		peers = append(peers, itoa(createdPeerID(t, rec)))
	}
	for _, p := range peers[:5] {
		if rec := authedReq(t, h, http.MethodPost, "/chats/"+p+"/pin", token, map[string]bool{"pinned": true}); rec.Code != http.StatusOK {
			t.Fatalf("закреп %s: %d %s", p, rec.Code, rec.Body.String())
		}
	}
	rec := authedReq(t, h, http.MethodPost, "/chats/"+peers[5]+"/pin", token, map[string]bool{"pinned": true})
	if got := wireErr(t, rec, http.StatusBadRequest); got != "PINNED_DIALOGS_TOO_MUCH" {
		t.Fatalf("6-й закреп: %q; want PINNED_DIALOGS_TOO_MUCH", got)
	}
}
