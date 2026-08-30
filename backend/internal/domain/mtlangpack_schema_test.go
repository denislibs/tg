package domain

import (
	"sort"
	"testing"
)

// Механическая сверка языкового пакета со схемой TL — со стороны ПРОИЗВОДИТЕЛЯ.
// Та же схема проверки, что у соседних подсистем: лишнего нет, пропущенное
// названо.

func TestLangPack_MatchesSchema(t *testing.T) {
	cases := []struct {
		name  string
		value any
	}{
		{"строка", NewLangPackString("Add", "Add")},
		{"строка с числом (две формы)", NewLangPackStringPluralized("Notifications.Count", PluralForms{
			One:   ptr("%d notification"),
			Other: "%d notifications",
		})},
		{"строка с числом (все формы)", NewLangPackStringPluralized("Notifications.Count", PluralForms{
			Zero:  ptr("ноль"),
			One:   ptr("%d уведомление"),
			Two:   ptr("два"),
			Few:   ptr("%d уведомления"),
			Many:  ptr("%d уведомлений"),
			Other: "%d уведомления",
		})},
		{"снятый ключ", NewLangPackStringDeleted("Gone")},
		{"разница", NewLangPackDifference("ru", 3, 5, []LangPackString{
			NewLangPackString("Add", "Добавить"),
			NewLangPackStringDeleted("Gone"),
		})},
		{"пустая разница", NewLangPackDifference("ru", 5, 5, nil)},
		{"язык-база", NewLangPackLanguage(LangPackLanguageMeta{
			Code: "en", Name: "English", NativeName: "English", PluralCode: "en",
		}, 1251, 1251)},
		{"язык с базой", NewLangPackLanguage(LangPackLanguageMeta{
			Code: "ru", Name: "Russian", NativeName: "Русский", PluralCode: "ru", BaseCode: "en",
		}, 1251, 600)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "langpack")
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

// Форма, которой у языка нет, — это ОТСУТСТВИЕ ПАРАМЕТРА, а не пустая строка.
// Записанная пустота доехала бы до экрана пустотой; отсутствующую форму клиент
// ищет по правилам CLDR дальше.
func TestLangPack_MissingPluralFormIsAbsentParam(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewLangPackStringPluralized("K", PluralForms{
		One: ptr("one"), Other: "other",
	})).(map[string]any)
	if !ok {
		t.Fatal("строка не разобралась в объект")
	}
	for _, absent := range []string{"zero_value", "two_value", "few_value", "many_value"} {
		if v, present := decoded[absent]; present {
			t.Errorf("%s присутствует со значением %v; форма без значения не должна ехать вовсе", absent, v)
		}
	}
	for _, want := range []string{"one_value", "other_value"} {
		if _, present := decoded[want]; !present {
			t.Errorf("%s не выведен", want)
		}
	}
}

// Формы едут КАЖДАЯ СВОИМ ПАРАМЕТРОМ и не перемешиваются.
//
// Это то самое место, где данные путаются молча: `many` у русского («5
// уведомлений») и `other` («1,5 уведомления») — разные тексты, и склеенные в
// один список они различаются только позицией. Тест адресует форму ИМЕНЕМ и
// краснеет, если конструктор разложил их иначе.
func TestLangPack_PluralFormsKeepTheirNames(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewLangPackStringPluralized("Notifications.Count", PluralForms{
		One:   ptr("%d уведомление"),
		Few:   ptr("%d уведомления"),
		Many:  ptr("%d уведомлений"),
		Other: "%d уведомления (дробное)",
	})).(map[string]any)
	if !ok {
		t.Fatal("строка не разобралась в объект")
	}
	for param, want := range map[string]string{
		"one_value":   "%d уведомление",
		"few_value":   "%d уведомления",
		"many_value":  "%d уведомлений",
		"other_value": "%d уведомления (дробное)",
	} {
		if got := decoded[param]; got != want {
			t.Errorf("%s = %v; want %q", param, got, want)
		}
	}
}

// Пустая разница — это ПУСТОЙ вектор, а не его отсутствие: `null` на месте
// `Vector<LangPackString>` клиент прочитает как отсутствие поля и упадёт на
// обходе, а «ничего не изменилось» — законный ответ метода.
func TestLangPack_EmptyDifferenceKeepsVector(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewLangPackDifference("ru", 5, 5, nil)).(map[string]any)
	if !ok {
		t.Fatal("разница не разобралась в объект")
	}
	v, present := decoded["strings"]
	if !present {
		t.Fatal("strings отсутствует")
	}
	list, ok := v.([]any)
	if !ok {
		t.Fatalf("strings = %T, а не вектор", v)
	}
	if len(list) != 0 {
		t.Errorf("strings = %v; ожидался пустой вектор", list)
	}
}

// У самой базы базы нет: `base_lang_code` необязателен, и у английского его не
// должно быть вовсе — иначе клиент пошёл бы за недостающей строкой к самому
// себе.
func TestLangPack_BaseLanguageHasNoBase(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewLangPackLanguage(LangPackLanguageMeta{
		Code: "en", Name: "English", NativeName: "English", PluralCode: "en",
	}, 1251, 1251)).(map[string]any)
	if !ok {
		t.Fatal("язык не разобрался в объект")
	}
	if v, present := decoded["base_lang_code"]; present {
		t.Errorf("base_lang_code = %v; у базы базы нет", v)
	}
	pflags, _ := decoded["pFlags"].(map[string]any)
	if pflags["official"] != true {
		t.Errorf("pFlags = %v; наши языки едут вместе с приложением и официальны", pflags)
	}
	if _, present := pflags["rtl"]; present {
		t.Errorf("pFlags.rtl поднят у английского: «выключено» — это отсутствие ключа")
	}
}

// Провод TL: конструкторы обязаны записаться байтами схемы. Здесь это не
// формальность — у `langPackStringPluralized` пять форм лежат ЗА МАСКОЙ, и
// ошибка в присутствии поля сдвинула бы поток, а не выдала ошибку.
func TestLangPack_WireTL(t *testing.T) {
	cases := []any{
		NewLangPackString("Add", "Добавить"),
		NewLangPackStringPluralized("Notifications.Count", PluralForms{
			One: ptr("%d уведомление"), Few: ptr("%d уведомления"),
			Many: ptr("%d уведомлений"), Other: "%d уведомления",
		}),
		NewLangPackStringDeleted("Gone"),
		NewLangPackDifference("ru", 0, 4, []LangPackString{
			NewLangPackString("Add", "Добавить"),
			NewLangPackStringDeleted("Gone"),
		}),
		NewLangPackLanguage(LangPackLanguageMeta{
			Code: "ru", Name: "Russian", NativeName: "Русский", PluralCode: "ru", BaseCode: "en",
		}, 1251, 600),
	}
	for _, v := range cases {
		if _, err := WireCodec.Marshal(v); err != nil {
			t.Errorf("%T не пишется на провод TL: %v", v, err)
		}
	}
}
