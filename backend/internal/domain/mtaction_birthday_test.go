package domain

import (
	"encoding/json"
	"testing"
	"time"
)

// Действие ЛЕЖИТ В БАЗЕ ровно тем объектом, что уезжает на провод
// (mtaction_parse.go), поэтому предложение даты рождения обязано пережить
// круг «конструктор → jsonb → конструктор» без потерь — и с годом, и без.
func TestParseMessageAction_SuggestBirthdayRoundTrip(t *testing.T) {
	for _, b := range []Birthday{
		{Underscore: BirthdayTag, Day: 8, Month: 3, Year: 1990},
		{Underscore: BirthdayTag, Day: 1, Month: 5},
	} {
		raw, err := json.Marshal(NewMessageActionSuggestBirthday(b))
		if err != nil {
			t.Fatal(err)
		}
		got, err := ParseMessageAction(raw)
		if err != nil {
			t.Fatalf("разбор %s: %v", raw, err)
		}
		a, ok := got.(MessageActionSuggestBirthday)
		if !ok {
			t.Fatalf("разобрано %T, want MessageActionSuggestBirthday", got)
		}
		if a.Tag() != MessageActionSuggestBirthdayTag || a.Birthday != b {
			t.Fatalf("круг потерял дату: %+v, want %+v", a, b)
		}
	}
}

// Дата рождения от клиента — ввод: день/месяц в своих границах, 31 февраля
// не «перекатывается» в март, год — не из будущего и не раньше 1900. Те же
// правила, что у собственной даты (PATCH /me), — одно место на оба входа.
func TestBirthday_Valid(t *testing.T) {
	now := time.Date(2026, time.September, 30, 12, 0, 0, 0, time.UTC)
	ok := []Birthday{
		{Underscore: BirthdayTag, Day: 29, Month: 2},              // без года — високосный допустим
		{Underscore: BirthdayTag, Day: 31, Month: 12, Year: 2026}, // текущий год
		{Underscore: BirthdayTag, Day: 1, Month: 1, Year: 1900},
	}
	for _, b := range ok {
		if _, err := b.Time(now); err != nil {
			t.Errorf("%+v отвергнута: %v", b, err)
		}
	}
	bad := []Birthday{
		{Underscore: BirthdayTag, Day: 0, Month: 1},
		{Underscore: BirthdayTag, Day: 32, Month: 1},
		{Underscore: BirthdayTag, Day: 1, Month: 13},
		{Underscore: BirthdayTag, Day: 31, Month: 2},
		{Underscore: BirthdayTag, Day: 29, Month: 2, Year: 2025},
		{Underscore: BirthdayTag, Day: 1, Month: 1, Year: 1899},
		{Underscore: BirthdayTag, Day: 1, Month: 1, Year: 2027},
	}
	for _, b := range bad {
		if _, err := b.Time(now); err == nil {
			t.Errorf("%+v принята", b)
		}
	}
	// Без года — сентинел BirthdayNoYear: обратный путь NewBirthday даёт ту же дату.
	tm, err := Birthday{Underscore: BirthdayTag, Day: 1, Month: 5}.Time(now)
	if err != nil || NewBirthday(tm) != (Birthday{Underscore: BirthdayTag, Day: 1, Month: 5}) {
		t.Fatalf("без года: %v %v", tm, err)
	}
}
