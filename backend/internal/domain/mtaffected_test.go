package domain

import (
	"encoding/json"
	"sort"
	"testing"
)

// F6: ответ deleteHistory — конструктор TL messages.affectedHistory. Сверка со
// схемой — тем же schemaChecker, что у обновлений (mtupdate_schema_test.go).
func TestMessagesAffectedHistory_WireAndSchema(t *testing.T) {
	v := NewMessagesAffectedHistory(10, 3)
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"_":"messages.affectedHistory","pts":10,"pts_count":3,"offset":0}`
	if string(raw) != want {
		t.Fatalf("провод = %s, want %s", raw, want)
	}

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		own:          loadOwnConstructors(t),
		omittedOK:    OmittedWithoutSubject,
	}
	c.walk(roundTripJSON(t, v), "result")
	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	for _, s := range c.unexpected {
		t.Errorf("лишнее: %s", s)
	}
	for _, s := range c.omitted {
		t.Errorf("пропущено: %s", s)
	}
}

// offset присутствует всегда, даже нулевой: «ключ есть» отличает конструктор
// от обрезанного ответа.
func TestMessagesAffectedHistory_ZeroValuesStayOnWire(t *testing.T) {
	raw, _ := json.Marshal(NewMessagesAffectedHistory(0, 0))
	const want = `{"_":"messages.affectedHistory","pts":0,"pts_count":0,"offset":0}`
	if string(raw) != want {
		t.Fatalf("провод = %s, want %s", raw, want)
	}
}
