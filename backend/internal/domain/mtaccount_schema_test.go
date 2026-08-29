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
		{"сессия устройства", NewAuthorization(currentDevice(), true)},
		{"чужая сессия", NewAuthorization(otherDevice(), false)},
		{"список сессий", NewAccountAuthorizations([]Authorization{
			NewAuthorization(currentDevice(), true)})},
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

// currentDevice/otherDevice — две строки устройств, какими их отдаёт хранилище:
// браузер, ОС и версия сборки лежат РАЗДЕЛЬНО, дата входа есть у обеих.
func currentDevice() Device {
	return Device{
		ID: 7, UserID: 1, Name: "Chrome", Platform: "web",
		SystemVersion: "macOS", AppVersion: "0.1.0 (1)",
		CreatedAt: time.Unix(1787330000, 0), LastActive: time.Unix(1787334148, 0),
		IP: "1.2.3.4", Location: "Москва",
	}
}

func otherDevice() Device {
	return Device{
		ID: 8, UserID: 1, Name: "Safari", Platform: "ios",
		SystemVersion: "iOS", AppVersion: "0.1.0 (1)",
		CreatedAt: time.Unix(1, 0), LastActive: time.Unix(2, 0),
	}
}

// «Текущая сессия» — ФЛАГ: его ОТСУТСТВИЕ и есть «не текущая». Прежде ехало
// булево поле `current: false`, то есть «выключено» имело значение.
//
// Но САМ под-объект pFlags едет всегда, даже пустым: так его строит
// десериализатор оригинала (`result.pFlags ??= {}`, tweb tl_utils.ts:754), и
// потому клиент читает `auth.pFlags.current` без страховки. Пропуск ключа ронял
// вкладку «Устройства» на TypeError у первой же чужой сессии.
func TestAccount_CurrentSessionIsAFlag(t *testing.T) {
	other, ok := roundTripJSON(t, NewAuthorization(otherDevice(), false)).(map[string]any)
	if !ok {
		t.Fatal("сессия не разобралась в объект")
	}
	flags, has := other["pFlags"].(map[string]any)
	if !has {
		t.Fatalf("у не-текущей сессии нет под-объекта pFlags: %v", other)
	}
	if len(flags) != 0 {
		t.Errorf("не-текущая сессия несёт флаги: %v", flags)
	}
	if _, has := other["current"]; has {
		t.Error("булево поле current осталось рядом с конструктором")
	}

	cur, _ := roundTripJSON(t, NewAuthorization(currentDevice(), true)).(map[string]any)
	if flags, _ := cur["pFlags"].(map[string]any); flags["current"] != true {
		t.Errorf("текущая сессия без флага current: %v", cur["pFlags"])
	}
}

// Адрес ТЕКУЩЕЙ сессии — ноль. Это семантика схемы: `hash` — то, чем сессию
// отзывают, а свою авторизацию по hash отозвать нельзя, для неё есть выход из
// аккаунта. Вкладка «Устройства» на этом и стоит: единственная строка, которую
// она не даёт завершить кликом, узнаётся по `dataset.hash === '0'`
// (tweb activeSessions.tsx:132,157). Отдай мы туда настоящий id — пользователь
// завершил бы собственную сессию.
func TestAccount_CurrentSessionHashIsZero(t *testing.T) {
	if cur := NewAuthorization(currentDevice(), true); cur.Hash != 0 {
		t.Errorf("hash текущей сессии = %d; у текущей авторизации адреса нет", cur.Hash)
	}
	if other := NewAuthorization(otherDevice(), false); other.Hash != 8 {
		t.Errorf("hash чужой сессии = %d; ожидался id устройства 8", other.Hash)
	}
}

// Реквизиты клиента: строка списка устройств собирается из них целиком —
// заголовок это `app_name + app_version`, вторая строка `device_model,
// system_version`, справа `max(date_active, date_created)`. Пустые они рисовали
// пользователю строку без названия и 1970 год.
func TestAccount_ClientIdentityIsProduced(t *testing.T) {
	a := NewAuthorization(currentDevice(), true)
	if a.AppName != AppName || a.AppName == "" {
		t.Errorf("app_name = %q; имя клиенту даёт сервер", a.AppName)
	}
	if a.AppVersion != "0.1.0 (1)" {
		t.Errorf("app_version = %q; ожидалась версия сборки, сообщённая при входе", a.AppVersion)
	}
	if a.SystemVersion != "macOS" {
		t.Errorf("system_version = %q; ожидалась ОС, разобранная из User-Agent", a.SystemVersion)
	}
	if a.DeviceModel != "Chrome" {
		t.Errorf("device_model = %q; ожидался браузер БЕЗ склейки с ОС", a.DeviceModel)
	}
	if a.DateCreated != 1787330000 {
		t.Errorf("date_created = %d; ожидался момент входа, а не ноль (1970 год на экране)", a.DateCreated)
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
