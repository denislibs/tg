package domain

import (
	"sort"
	"testing"
)

// Механическая сверка календаря медиа со схемой TL.

func TestCalendar_MatchesSchema(t *testing.T) {
	msg := MessageReal{
		Underscore: MessageTag, ID: 12, PeerID: NewPeerUser(5), FromID: NewPeerUser(7),
		Date: 1750000000, Message: "снимок",
	}
	cases := []struct {
		name  string
		value any
	}{
		{"отрезок дня", NewSearchResultsCalendarPeriod(1750000000, 10, 12, 3)},
		{"контейнер", NewMessagesSearchResultsCalendar(
			[]SearchResultsCalendarPeriod{NewSearchResultsCalendarPeriod(1750000000, 10, 12, 3)},
			[]MTMessage{msg},
			[]UserReal{{Underscore: UserTag, ID: 7}},
		)},
		{"пустой месяц", NewMessagesSearchResultsCalendar(nil, nil, nil)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				// Пропуски уже названы подсистемой сообщения (клиентские
				// параметры, реквизиты транспорта) — календарь везёт те же
				// сообщения, что и история.
				omittedOK: viewsOmittedOK(),
			}
			c.walk(roundTripJSON(t, tc.value), "calendar")
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

// Границы считаются ПО ОТРЕЗКАМ, а не приходят отдельным аргументом: иначе
// «самая ранняя дата» и сами дни были бы двумя независимыми утверждениями об
// одном и том же, и они бы разъехались.
func TestCalendar_BoundsComeFromPeriods(t *testing.T) {
	out := NewMessagesSearchResultsCalendar([]SearchResultsCalendarPeriod{
		NewSearchResultsCalendarPeriod(1750200000, 30, 33, 4),
		NewSearchResultsCalendarPeriod(1750000000, 10, 12, 3),
	}, nil, nil)

	if out.Count != 7 {
		t.Errorf("count = %d; ожидалась сумма отрезков 7", out.Count)
	}
	if out.MinDate != 1750000000 {
		t.Errorf("min_date = %d; ожидалась самая ранняя дата", out.MinDate)
	}
	if out.MinMsgID != 10 {
		t.Errorf("min_msg_id = %d; ожидался наименьший номер", out.MinMsgID)
	}
}

// Пустой месяц — это ПУСТЫЕ ВЕКТОРЫ и нулевые границы, а не отсутствие
// параметров: у обязательного вектора «ничего нет» выражается как `[]`, а
// выдуманная граница соврала бы о наличии данных.
func TestCalendar_EmptyMonthKeepsVectors(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewMessagesSearchResultsCalendar(nil, nil, nil)).(map[string]any)
	if !ok {
		t.Fatal("контейнер не разобрался в объект")
	}
	for _, key := range []string{"periods", "messages", "chats", "users"} {
		v, present := decoded[key]
		if !present {
			t.Errorf("вектор %s пропал вовсе", key)
			continue
		}
		if items, ok := v.([]any); !ok || len(items) != 0 {
			t.Errorf("вектор %s = %v; ожидался пустой", key, v)
		}
	}
	if decoded["min_date"] != float64(0) || decoded["min_msg_id"] != float64(0) {
		t.Errorf("границы пустого месяца = %v/%v; ожидались нули", decoded["min_date"], decoded["min_msg_id"])
	}
}
