package domain

import (
	"encoding/json"
	"sort"
	"testing"
)

// Механическая сверка настроек приватности со схемой TL — тот же
// `schemaChecker`, что у медиа, стикеров, историй и остальных.
//
// Проверяется то, чего у этой подсистемы не было НИКОГДА: что ключ настройки —
// конструктор, а не строка, и что настройка — вектор правил, а не запись с
// базовым значением и двумя списками исключений рядом.

func privacyCases() []struct {
	name  string
	value any
} {
	rec := PrivacyRuleRecord{
		Key:          PrivacyLastSeen,
		Value:        PrivacyContacts,
		AllowUserIDs: []int64{42},
		DenyUserIDs:  []int64{43},
	}
	return []struct {
		name  string
		value any
	}{
		{"правила ключа", NewAccountPrivacyRules(PrivacyRulesOf(rec), nil, nil)},
		{"всем", NewAccountPrivacyRules(PrivacyRulesOf(
			PrivacyRuleRecord{Key: PrivacyAbout, Value: PrivacyEverybody}), nil, nil)},
		{"никому", NewAccountPrivacyRules(PrivacyRulesOf(
			PrivacyRuleRecord{Key: PrivacyAbout, Value: PrivacyNobody}), nil, nil)},
	}
}

func TestPrivacy_MatchesSchema(t *testing.T) {
	for _, tc := range privacyCases() {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "privacy")
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

// Ключ настройки — КОНСТРУКТОР схемы, а не наша строка. Сверщик до него не
// доходит (ключ едет в пути запроса, не в теле), поэтому пин отдельный.
func TestPrivacy_KeysAreSchemaConstructors(t *testing.T) {
	schema := loadSchemaConstructors(t)
	own := loadOwnConstructors(t)
	for key := range privacyKeyTags {
		tag, _ := PrivacyKeyTag(key)
		ctor, ok := schema[tag]
		if !ok {
			ctor, ok = own[tag]
		}
		if !ok {
			t.Errorf("ключ %q: конструктора %q нет ни в схеме, ни в надстройках", key, tag)
			continue
		}
		if ctor.Type != "PrivacyKey" {
			t.Errorf("ключ %q: %q объявлен как %s, а не PrivacyKey", key, tag, ctor.Type)
		}
	}
}

// Каждый наш ключ обязан иметь конструктор: без него настройка молча
// перестала бы доезжать — маршрут отверг бы её как неизвестную.
func TestPrivacy_EveryKeyHasAConstructor(t *testing.T) {
	for _, key := range PrivacyKeys {
		if _, ok := PrivacyKeyTag(key); !ok {
			t.Errorf("ключ %q остался без конструктора", key)
		}
	}
}

// Два ключа — НАШИ: предмет у оригинала есть, но двузначный (флаги
// globalPrivacySettings), а наш экран предлагает им тот же выбор из трёх, что
// и остальным. Пин держит именно это: конструкторы объявлены нами, а не взяты
// из схемы, — и если кто-то решит, что они «просто пропущены в схеме», тест
// объяснит, почему нет.
func TestPrivacy_TwoKeysAreOurOwn(t *testing.T) {
	schema := loadSchemaConstructors(t)
	own := loadOwnConstructors(t)
	for _, key := range []PrivacyKey{PrivacyMessages, PrivacyReadTime} {
		tag, _ := PrivacyKeyTag(key)
		if _, inSchema := schema[tag]; inSchema {
			t.Errorf("ключ %q: конструктор %q нашёлся в схеме — значит он не наш", key, tag)
		}
		if _, declared := own[tag]; !declared {
			t.Errorf("ключ %q: конструктор %q не объявлен в надстройках", key, tag)
		}
	}
}

// Порядок правил в векторе — не косметика: исключение, поставленное ПОСЛЕ
// «всем», уже ничего не изменило бы (порт getPrivacyRulesDetails).
func TestPrivacy_ExceptionsComeBeforeTheBaseValue(t *testing.T) {
	rules := PrivacyRulesOf(PrivacyRuleRecord{
		Value:        PrivacyEverybody,
		AllowUserIDs: []int64{1},
		DenyUserIDs:  []int64{2},
	})
	tags := make([]string, 0, len(rules))
	for _, r := range rules {
		tags = append(tags, r.Tag())
	}
	want := []string{PrivacyValueAllowUsersTag, PrivacyValueDisallowUsersTag, PrivacyValueAllowAllTag}
	if len(tags) != len(want) {
		t.Fatalf("правил %d, ожидалось %d: %v", len(tags), len(want), tags)
	}
	for i := range want {
		if tags[i] != want[i] {
			t.Fatalf("порядок правил %v, ожидался %v", tags, want)
		}
	}
}

// Круг «запись → вектор → запись»: обе половины соответствия обязаны сходиться,
// иначе сохранённая настройка вернулась бы другой.
func TestPrivacy_RoundTripsThroughTheUnion(t *testing.T) {
	for _, value := range []string{PrivacyEverybody, PrivacyContacts, PrivacyNobody} {
		in := PrivacyRuleRecord{
			Key:          PrivacyLastSeen,
			Value:        value,
			AllowUserIDs: []int64{7},
			DenyUserIDs:  []int64{8},
		}
		out := PrivacyRecordOf(in.Key, PrivacyRulesOf(in))
		if out.Value != in.Value || len(out.AllowUserIDs) != 1 || len(out.DenyUserIDs) != 1 {
			t.Errorf("круг для %q дал %+v", value, out)
		}
	}
}

// Разбор вектора ветвится по дискриминатору, а незнакомый конструктор —
// ОШИБКА: молча выброшенное правило означает аудиторию шире запрошенной.
func TestPrivacy_UnknownRuleIsAnError(t *testing.T) {
	var u PrivacyRuleUnion
	if err := json.Unmarshal([]byte(`[{"_":"privacyValueAllowAll"}]`), &u); err != nil {
		t.Fatalf("известный конструктор не разобрался: %v", err)
	}
	if len(u) != 1 || u[0].Tag() != PrivacyValueAllowAllTag {
		t.Fatalf("разбор дал %+v", u)
	}
	if err := json.Unmarshal([]byte(`[{"_":"privacyValueAllowBots"}]`), &u); err == nil {
		t.Error("незнакомый конструктор проехал молча")
	}
}
