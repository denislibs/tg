package domain

import (
	"sort"
	"testing"
	"time"
)

// Механическая сверка витрин аккаунта со схемой TL: сессии устройств, адресная
// книга, фотогалерея.

func accountCases() []struct {
	name  string
	value any
} {
	return []struct {
		name  string
		value any
	}{
		{"сессия устройства", NewAuthorization(7, "Chrome", "web", "1.2.3.4", "Москва",
			time.Time{}, time.Unix(1787334148, 0), true)},
		{"чужая сессия", NewAuthorization(8, "Safari", "ios", "", "", time.Time{}, time.Unix(1, 0), false)},
		{"список сессий", NewAccountAuthorizations([]Authorization{
			NewAuthorization(7, "Chrome", "web", "", "", time.Time{}, time.Unix(1, 0), true)})},
		{"строка книги", NewContact(9, false)},
		{"адресная книга", NewContactsContacts(
			[]Contact{NewContact(9, false)},
			[]UserReal{{Underscore: UserTag, ID: 9, FirstName: "Аня"}})},
		{"пустая книга", NewContactsContacts(nil, nil)},
		{"одна фотография", NewPhotosPhoto(*NewPhoto(42, []PhotoSize{}))},
		{"галерея", NewPhotosPhotos([]Photo{*NewPhoto(42, []PhotoSize{})})},
	}
}

func TestAccount_MatchesSchema(t *testing.T) {
	for _, tc := range accountCases() {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "account")
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

// «Текущая сессия» — ФЛАГ: его ОТСУТСТВИЕ и есть «не текущая». Прежде ехало
// булево поле `current: false`, то есть «выключено» имело значение.
func TestAccount_CurrentSessionIsAFlag(t *testing.T) {
	other, ok := roundTripJSON(t, NewAuthorization(8, "Safari", "ios", "", "", time.Time{}, time.Unix(1, 0), false)).(map[string]any)
	if !ok {
		t.Fatal("сессия не разобралась в объект")
	}
	if _, has := other["pFlags"]; has {
		t.Errorf("не-текущая сессия несёт pFlags: %v", other["pFlags"])
	}
	if _, has := other["current"]; has {
		t.Error("булево поле current осталось рядом с конструктором")
	}
}

// Взаимность контакта — КОНСТРУКТОР `Bool`, а не голое булево: у оригинала это
// полноценный тип, и в объекте он объектом и лежит.
func TestAccount_ContactMutualIsABoolConstructor(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewContact(9, true)).(map[string]any)
	if !ok {
		t.Fatal("строка книги не разобралась в объект")
	}
	mutual, ok := decoded["mutual"].(map[string]any)
	if !ok || mutual["_"] != BoolTrueTag {
		t.Errorf("mutual = %v; ожидался конструктор Bool", decoded["mutual"])
	}
}
