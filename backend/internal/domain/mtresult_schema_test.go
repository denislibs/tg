package domain

import (
	"sort"
	"testing"
)

// Механическая сверка ответов «получилось» и «не получилось» со схемой TL —
// тот же `schemaChecker`, что у медиа, стикеров, историй и остальных.
//
// Сверка выглядит скромно (у `boolTrue` параметров нет вовсе, у `error` их
// два), но проверяет она ровно то, чего у этих двух витрин не было НИКОГДА:
// что у ответа есть тип. Пока ответом была карта, сверщик до него не доходил —
// он ходит по типам Go.
func resultCases() []struct {
	name  string
	value any
} {
	return []struct {
		name  string
		value any
	}{
		{"получилось", NewBool(true)},
		{"не получилось", NewBool(false)},
		{"ошибка", NewError(403, "not a member of this chat")},
	}
}

func TestResult_MatchSchema(t *testing.T) {
	for _, tc := range resultCases() {
		t.Run(tc.name, func(t *testing.T) {
			unexpected, omitted := checkResultAgainstSchema(t, tc.value)
			for _, s := range unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range omitted {
				t.Errorf("пропущено: %s", s)
			}
		})
	}
}

func checkResultAgainstSchema(t *testing.T, value any) (unexpected, omitted []string) {
	t.Helper()

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		own:          loadOwnConstructors(t),
		omittedOK:    OmittedWithoutSubject,
	}
	c.walk(roundTripJSON(t, value), "result")

	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

// Выбор конструктора — единственное содержимое `Bool`, поэтому отдельный пин:
// сверка со схемой прошла бы и на одном `boolTrue`, а «не получилось»,
// поехавшее как «получилось», — это не расхождение формы, а ложь по существу.
func TestResult_BoolIsAChoiceOfConstructor(t *testing.T) {
	if got := NewBool(true).Underscore; got != BoolTrueTag {
		t.Errorf("«получилось» = %q, ожидался %q", got, BoolTrueTag)
	}
	if got := NewBool(false).Underscore; got != BoolFalseTag {
		t.Errorf("«не получилось» = %q, ожидался %q", got, BoolFalseTag)
	}
}

// Код ошибки — ПАРАМЕТР тела, а не только строка статуса: по проводу DNP ответ
// едет своим конвертом, и строки протокола там нет вовсе.
func TestResult_ErrorCarriesCodeAndText(t *testing.T) {
	e := NewError(429, "too many requests")
	if e.Code != 429 || e.Text != "too many requests" {
		t.Errorf("ошибка потеряла содержимое: %+v", e)
	}
}
