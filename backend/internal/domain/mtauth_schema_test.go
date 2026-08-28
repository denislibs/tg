package domain

import (
	"sort"
	"testing"
	"time"
)

// Механическая сверка витрин входа со схемой TL: исход шага, QR-код,
// восстановление пароля, веб-токен и страна по IP.

func authCases() []struct {
	name  string
	value any
} {
	me := UserReal{Underscore: UserTag, ID: 7, FirstName: "Аня"}
	return []struct {
		name  string
		value any
	}{
		{"сессия выдана", NewAuthAuthorization("s3cret", me)},
		{"нужна регистрация", NewAuthAuthorizationSignUpRequired("signup")},
		{"нужен облачный пароль", NewAuthPasswordNeeded("pwtok", "первая буква имени")},
		{"без подсказки", NewAuthPasswordNeeded("pwtok", "")},
		{"QR выпущен", NewAuthLoginToken([]byte{0xDE, 0xAD, 0xBE, 0xEF}, time.Unix(1787334148, 0))},
		{"QR подтверждён", NewAuthLoginTokenSuccess(NewAuthAuthorization("s3cret", me))},
		{"маска почты", NewAuthPasswordRecovery("d****@e******.com")},
		{"веб-токен", NewAuthWebAuthToken("web", time.Unix(1787334148, 0))},
		{"страна определилась", NewHelpCountryCode("RU")},
		{"страна не определилась", NewHelpCountryCode("")},
	}
}

func TestAuth_MatchesSchema(t *testing.T) {
	for _, tc := range authCases() {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "auth")
			sort.Strings(c.unexpected)
			sort.Strings(c.omitted)
			for _, s := range c.unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range c.omitted {
				t.Errorf("пропущено: %s", s)
			}
		})
	}
}

// Исход шага входа назван КОНСТРУКТОРОМ, а не набором признаков рядом. Прежде
// клиент выяснял его наличием ключей `password_needed`/`signup_required` —
// значит «выключено» имело значение, а третья ветка не имела имени вовсе.
func TestAuth_OutcomeIsNamedByConstructor(t *testing.T) {
	cases := []struct {
		name string
		v    AuthAuthorization
		tag  string
	}{
		{"сессия", NewAuthAuthorization("s", UserReal{Underscore: UserTag, ID: 7}), AuthAuthorizationTag},
		{"регистрация", NewAuthAuthorizationSignUpRequired("t"), AuthAuthorizationSignUpRequiredTag},
		{"облачный пароль", NewAuthPasswordNeeded("t", ""), AuthPasswordNeededTag},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			decoded, ok := roundTripJSON(t, tc.v).(map[string]any)
			if !ok {
				t.Fatal("исход не разобрался в объект")
			}
			if decoded["_"] != tc.tag {
				t.Errorf("_ = %v, ожидался %q", decoded["_"], tc.tag)
			}
			for _, dead := range []string{"password_needed", "signup_required"} {
				if _, has := decoded[dead]; has {
					t.Errorf("признак %q остался рядом с конструктором", dead)
				}
			}
		})
	}
}

// Подтверждённый QR несёт ТОТ ЖЕ исход входа, что и обычный шаг, — вложенным
// конструктором, а не второй формой (`session_token` + `user` соседями).
func TestAuth_ConfirmedQRCarriesTheSameOutcome(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewAuthLoginTokenSuccess(
		NewAuthAuthorization("s3cret", UserReal{Underscore: UserTag, ID: 7}))).(map[string]any)
	if !ok {
		t.Fatal("подтверждённый QR не разобрался в объект")
	}
	inner, ok := decoded["authorization"].(map[string]any)
	if !ok || inner["_"] != AuthAuthorizationTag {
		t.Fatalf("authorization = %v; ожидался конструктор исхода входа", decoded["authorization"])
	}
	if inner["token"] != "s3cret" {
		t.Errorf("ключ сессии = %v, ожидался внутри исхода", inner["token"])
	}
	if _, has := decoded["session_token"]; has {
		t.Error("session_token остался соседним ключом")
	}
}
