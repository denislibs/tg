package domain

import (
	"sort"
	"testing"
	"time"
)

// Сверка ТИПИЗИРОВАННОЙ пачки апдейтов (витрина REST) со схемой. Оболочка кадра
// WS собирается словарями и проверяется своим кругом тестов (mtwire_test.go);
// здесь — та сборка, что идёт из доменных значений.

func TestUpdatesContainer_MatchesSchema(t *testing.T) {
	value := NewUpdates([]Update{
		NewUpdateDraftMessage(NewPeerUser(7), NewDraftMessage("привет", nil, nil, time.Unix(1787334148, 0))),
		NewUpdateDraftMessage(NewPeerUser(8), NewDraftMessageEmpty()),
	}, time.Unix(1787334148, 0))

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		own:          loadOwnConstructors(t),
		omittedOK:    OmittedWithoutSubject,
	}
	c.walk(roundTripJSON(t, value), "updates")
	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	for _, s := range c.unexpected {
		t.Errorf("лишнее: %s", s)
	}
	for _, s := range c.omitted {
		t.Errorf("пропущено: %s", s)
	}
}

// Пустая пачка остаётся ВЕКТОРОМ, а не null: у обязательного параметра схемы
// «пусто» это пустой вектор, а не отсутствие значения.
func TestUpdatesContainer_EmptyStaysVector(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewUpdates(nil, time.Unix(1, 0))).(map[string]any)
	if !ok {
		t.Fatal("пачка не разобралась в объект")
	}
	for _, key := range []string{"updates", "users", "chats"} {
		if _, isList := decoded[key].([]any); !isList {
			t.Errorf("%s = %#v, ожидался вектор", key, decoded[key])
		}
	}
}
