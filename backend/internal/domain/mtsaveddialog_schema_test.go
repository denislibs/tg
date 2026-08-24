package domain

import (
	"sort"
	"testing"
)

// Механическая сверка витрины «Избранного» со схемой TL.

func TestSavedDialogs_MatchesSchema(t *testing.T) {
	cases := []struct {
		name  string
		value any
	}{
		{"строка", NewSavedDialog(NewPeerUser(7), 42)},
		{"контейнер", NewMessagesSavedDialogs(
			[]SavedDialog{NewSavedDialog(NewPeerUser(7), 42)},
			[]MTMessage{MessageReal{Underscore: MessageTag, ID: 42, PeerID: NewPeerUser(7), Date: 1787334148}},
			nil, []UserReal{{Underscore: UserTag, ID: 7}})},
		{"пустой контейнер", NewMessagesSavedDialogs(nil, nil, nil, nil)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "saved")
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

// Строка несёт только ССЫЛКИ: снимка источника (заголовок, аватарка), вида
// строкой (`kind`) и счётчика сообщений в ней нет. Прежде всё это ехало рядом,
// подклеенное JOIN-ами прямо в выборку.
func TestSavedDialogs_RowCarriesReferencesOnly(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewSavedDialog(NewPeerUser(7), 42)).(map[string]any)
	if !ok {
		t.Fatal("строка не разобралась в объект")
	}
	for _, dead := range []string{"kind", "title", "photo_id", "count", "last_message"} {
		if _, has := decoded[dead]; has {
			t.Errorf("снимок %q остался в строке", dead)
		}
	}
	peer, ok := decoded["peer"].(map[string]any)
	if !ok || peer["_"] != PeerUserTag {
		t.Fatalf("peer = %v; ожидался конструктор ключа", decoded["peer"])
	}
	if decoded["top_message"] != float64(42) {
		t.Errorf("top_message = %v, ожидалась ссылка на последнее сообщение", decoded["top_message"])
	}
}
