package domain

import (
	"encoding/json"
	"sort"
	"testing"
)

// Механическая сверка модели СУЩНОСТЕЙ со схемой TL — зеркало
// mtmedia_schema_test.go, тот же сверщик (schemaChecker), те же два
// утверждения:
//
//  1. Лишнего нет: каждый ключ сериализованного объекта — параметр конструктора
//     из схемы либо клиентский параметр из schema_additional_params.json.
//
//  2. Пропущенное названо: обязательные параметры схемы, которых нет в выводе,
//     сверяются с явным списком «нет предмета» (для сущностей он ПУСТ — у всех
//     одиннадцати конструкторов мы выводим все обязательные параметры).
//
// Тест не проверяет типы значений и порядок полей — это работа кодека (фаза 2).

// entitiesOmittedWithoutSubject — обязательных параметров, которых мы не
// производим, у сущностей нет вовсе: offset/length/language/url/user_id/
// document_id выводятся все. Пустая карта здесь — утверждение, а не забывчивость:
// появится непроизводимый параметр — его придётся назвать здесь явно.
var entitiesOmittedWithoutSubject = map[string][]string{}

func checkEntitiesAgainstSchema(t *testing.T, es MessageEntities) (unexpected, omitted []string) {
	t.Helper()

	raw, err := json.Marshal(es)
	if err != nil {
		t.Fatalf("разметка не сериализуется: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разметка не разбирается обратно: %v", err)
	}

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		omittedOK:    entitiesOmittedWithoutSubject,
	}
	c.walk(decoded, "entities")
	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

// allEntityConstructors — по одному экземпляру КАЖДОГО конструктора нашего
// объединения. Новый конструктор без строки здесь просто не будет сверен со
// схемой, поэтому список продублирован проверкой полноты ниже.
func allEntityConstructors() MessageEntities {
	return MessageEntities{
		NewMessageEntityBold(0, 1),
		NewMessageEntityItalic(1, 1),
		NewMessageEntityUnderline(2, 1),
		NewMessageEntityStrike(3, 1),
		NewMessageEntityCode(4, 1),
		NewMessageEntityPre(5, 1, "go"),
		NewMessageEntityPre(6, 1, ""), // обязательный language едет и пустым
		NewMessageEntitySpoiler(7, 1),
		NewMessageEntityBlockquote(8, 1, false),
		NewMessageEntityBlockquote(9, 1, true), // pFlags.collapsed
		NewMessageEntityTextURL(10, 1, "https://example.com"),
		NewMessageEntityMentionName(11, 1, 42),
		NewMessageEntityCustomEmoji(12, 1, 7),
	}
}

func TestMessageEntities_MatchSchema(t *testing.T) {
	unexpected, omitted := checkEntitiesAgainstSchema(t, allEntityConstructors())
	for _, v := range unexpected {
		t.Errorf("лишнее поле: %s", v)
	}
	for _, v := range omitted {
		t.Errorf("молчаливый пропуск: %s", v)
	}
}

// Полнота: каждое объявленное значение дискриминатора реально встречается среди
// сверенных объектов. Иначе конструктор можно было бы завести и забыть про него.
func TestMessageEntities_EveryConstructorIsChecked(t *testing.T) {
	seen := map[string]bool{}
	for _, e := range allEntityConstructors() {
		seen[e.Tag()] = true
	}
	for _, tag := range []string{
		EntityBold, EntityItalic, EntityUnderline, EntityStrike, EntityCode,
		EntityPre, EntitySpoiler, EntityBlockquote, EntityTextURL,
		EntityMentionName, EntityCustomEmoji,
	} {
		if !seen[tag] {
			t.Errorf("конструктор %q не участвует в сверке со схемой", tag)
		}
		if _, ok := loadSchemaConstructors(t)[tag]; !ok {
			t.Errorf("конструктора %q нет в схеме", tag)
		}
	}
}

// pFlags несёт только true: «выключено» — это отсутствие ключа.
func TestMessageEntities_PFlagsNeverFalse(t *testing.T) {
	raw, _ := json.Marshal(allEntityConstructors())
	var decoded []map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	for _, obj := range decoded {
		pf, ok := obj["pFlags"]
		if !ok {
			continue
		}
		flags, _ := pf.(map[string]any)
		if len(flags) == 0 {
			t.Errorf("%v: пустой pFlags сериализован — должен отсутствовать", obj["_"])
		}
		for k, v := range flags {
			if v != true {
				t.Errorf("%v: pFlags[%q] = %v, а «выключено» — это отсутствие ключа", obj["_"], k, v)
			}
		}
	}
}

// Разбор: дискриминатор ведёт в свой конструктор, чужой/отсутствующий —
// сущность отбрасывается, а не роняет весь вектор.
func TestMessageEntities_Unmarshal(t *testing.T) {
	in := []byte(`[
		{"_":"messageEntityBold","offset":0,"length":2},
		{"type":"bold","offset":0,"length":2},
		{"_":"messageEntityBankCard","offset":0,"length":2},
		{"_":"messageEntityBlockquote","pFlags":{"collapsed":true},"offset":2,"length":3},
		{"_":"messageEntityBlockquote","pFlags":{"collapsed":false},"offset":5,"length":3},
		{"_":"messageEntityPre","offset":8,"length":3,"language":""}
	]`)
	var es MessageEntities
	if err := json.Unmarshal(in, &es); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	if len(es) != 4 {
		t.Fatalf("разобрано %d сущностей, ждали 4: %+v", len(es), es)
	}
	if _, ok := es[0].(MessageEntityBold); !ok {
		t.Errorf("es[0] = %#v, ждали messageEntityBold", es[0])
	}
	bq, ok := es[1].(MessageEntityBlockquote)
	if !ok || !bq.Collapsed() {
		t.Errorf("es[1] = %#v, ждали свёрнутую цитату", es[1])
	}
	// collapsed:false — это ОТСУТСТВИЕ флага, а не флаг со значением false.
	bq2, ok := es[2].(MessageEntityBlockquote)
	if !ok || bq2.PFlags != nil {
		t.Errorf("es[2] = %#v, ждали цитату без pFlags", es[2])
	}
	if pre, ok := es[3].(MessageEntityPre); !ok || pre.Language != "" {
		t.Errorf("es[3] = %#v, ждали messageEntityPre с пустым language", es[3])
	}
}
