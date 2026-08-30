package langsource

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// repoRoot — корень репозитория: backend/internal/langsource → вверх на три.
const repoRoot = "../../.."

// Сторож снимка.
//
// Переводы правятся в файлах клиента, а сервер отдаёт вшитый снимок — то есть
// КОПИЮ. Копия расходится с оригиналом молча: правка в `dict.ru.ts` без
// перегенерации оставила бы сервер на старом тексте, и увидеть это можно было бы
// только глазами на стенде, сравнив две строки на разных языках.
//
// Тест читает те же .ts тем же кодом и сравнивает с файлом снимка. Правка без
// `go run ./cmd/langpackgen` красит его.
func TestSnapshotMatchesDictionaries(t *testing.T) {
	fresh, err := Extract(repoRoot)
	if err != nil {
		t.Fatalf("словари клиента не читаются: %v", err)
	}
	embedded, err := Embedded()
	if err != nil {
		t.Fatalf("вшитый снимок не читается: %v", err)
	}

	if len(fresh.Languages) != len(embedded.Languages) {
		t.Fatalf("в снимке %d языков, в словарях %d — перегенерируй: go run ./cmd/langpackgen",
			len(embedded.Languages), len(fresh.Languages))
	}
	for i, want := range fresh.Languages {
		got := embedded.Languages[i]
		if got.LangPackLanguageMeta != want.LangPackLanguageMeta {
			t.Errorf("паспорт языка %s разошёлся: снимок %+v, словари %+v", want.Code, got.LangPackLanguageMeta, want.LangPackLanguageMeta)
			continue
		}
		if len(got.Strings) != len(want.Strings) {
			t.Errorf("%s: в снимке %d строк, в словаре %d — перегенерируй: go run ./cmd/langpackgen",
				want.Code, len(got.Strings), len(want.Strings))
			continue
		}
		for j, wantRec := range want.Strings {
			if !reflect.DeepEqual(got.Strings[j], wantRec) {
				t.Errorf("%s: строка %q разошлась со словарём — перегенерируй: go run ./cmd/langpackgen",
					want.Code, wantRec.Key)
			}
		}
	}
}

// Снимок обязан лежать на диске в том же виде, в каком его пишет генератор:
// иначе «файл собран заново» отличалось бы от «файл не тронут» переносами строк,
// и дифф снимка перестал бы читаться глазами.
func TestSnapshotFileIsGeneratorOutput(t *testing.T) {
	pack, err := Embedded()
	if err != nil {
		t.Fatalf("снимок не читается: %v", err)
	}
	raw, err := Marshal(pack)
	if err != nil {
		t.Fatalf("снимок не сериализуется: %v", err)
	}
	if string(raw) != string(snapshot) {
		t.Error("файл снимка не совпадает с выводом генератора — перегенерируй: go run ./cmd/langpackgen")
	}
}

// Английский — БАЗА: каждый переведённый ключ обязан в нём быть, иначе перевод
// мёртв (клиент такой ключ не спросит никогда). Проверка живёт в Extract и
// краснеет прямо там; здесь — утверждение о живых данных.
func TestExtractedTranslationsAreSubsetOfBase(t *testing.T) {
	pack, err := Extract(repoRoot)
	if err != nil {
		t.Fatalf("словари не читаются: %v", err)
	}
	if pack.Languages[0].Code != "en" {
		t.Fatalf("первым языком идёт %s, а базой обязан быть en", pack.Languages[0].Code)
	}
	base := map[string]bool{}
	for _, s := range pack.Languages[0].Strings {
		base[s.Key] = true
	}
	for _, lang := range pack.Languages[1:] {
		if lang.BaseCode != "en" {
			t.Errorf("%s: база %q, а недостающие строки берутся из английского", lang.Code, lang.BaseCode)
		}
		for _, s := range lang.Strings {
			if !base[s.Key] {
				t.Errorf("%s: ключа %q нет в английском источнике", lang.Code, s.Key)
			}
		}
	}
}

// Формы числа доезжают до снимка КАЖДАЯ СВОИМ ИМЕНЕМ.
//
// Тест адресует конкретную живую строку: русское «уведомлений» — это CLDR-`many`,
// а «уведомления» в `other` достаётся дробным («1,5 уведомления»). Перепутать их
// местами — ровно та ошибка, которую позиционный список форм не ловит ничем.
func TestExtractedPluralFormsKeepCLDRNames(t *testing.T) {
	pack, err := Embedded()
	if err != nil {
		t.Fatalf("снимок не читается: %v", err)
	}
	var ru *Language
	for i := range pack.Languages {
		if pack.Languages[i].Code == "ru" {
			ru = &pack.Languages[i]
		}
	}
	if ru == nil {
		t.Fatal("русского нет в снимке")
	}
	for _, s := range ru.Strings {
		if s.Key != "Notifications.Count" {
			continue
		}
		if s.Forms == nil {
			t.Fatalf("Notifications.Count у русского — строка без форм: %+v", s)
		}
		f := *s.Forms
		if f.One == nil || *f.One != "%d уведомление" {
			t.Errorf("one_value = %v; want «%%d уведомление»", deref(f.One))
		}
		if f.Few == nil || *f.Few != "%d уведомления" {
			t.Errorf("few_value = %v; want «%%d уведомления»", deref(f.Few))
		}
		if f.Many == nil || *f.Many != "%d уведомлений" {
			t.Errorf("many_value = %v; want «%%d уведомлений» (форма 5-20, а не other)", deref(f.Many))
		}
		if f.Other != "%d уведомления" {
			t.Errorf("other_value = %q; want «%%d уведомления» (дробные)", f.Other)
		}
		return
	}
	t.Fatal("Notifications.Count не найден у русского")
}

func deref(s *string) string {
	if s == nil {
		return "<нет формы>"
	}
	return *s
}

// ── Разбор словаря ──────────────────────────────────────────────────────────

func TestParseDictSubset(t *testing.T) {
	src := `import I18n from '@lib/langPack'

const dict = {
  // Комментарий строкой
  Bare: 'значение',
  'Ключ.С.Точками': 'другое',
  /* блочный
     комментарий */
  'Экранирование': 'don\'t \\ break\nline',
  'Формы': { one_value: 'одна', other_value: 'много' },
  'Хвостовая запятая': 'есть',
} satisfies LangPackDict

export default I18n.formatLocalStrings(dict)
`
	pairs, err := parseDict(src)
	if err != nil {
		t.Fatalf("разбор: %v", err)
	}
	if len(pairs) != 5 {
		t.Fatalf("разобрано %d пар, ожидалось 5: %+v", len(pairs), pairs)
	}
	if pairs[0].key != "Bare" || *pairs[0].str != "значение" {
		t.Errorf("голый ключ разобран как (%q, %v)", pairs[0].key, pairs[0].str)
	}
	if pairs[1].key != "Ключ.С.Точками" {
		t.Errorf("ключ в кавычках разобран как %q", pairs[1].key)
	}
	if got := *pairs[2].str; got != "don't \\ break\nline" {
		t.Errorf("экранирование разобрано как %q", got)
	}
	if got := pairs[3].forms; got["one_value"] != "одна" || got["other_value"] != "много" {
		t.Errorf("формы разобраны как %v", got)
	}
	// Порядок сохраняется: снимок обязан переписываться построчно.
	if pairs[4].key != "Хвостовая запятая" {
		t.Errorf("последним разобран %q", pairs[4].key)
	}
}

// Разбор СТРОГИЙ: непонятное — ошибка с номером строки, а не пропуск. Молча
// пропущенная строка выглядит как «перевода нет» и вылезает пустотой на экране.
func TestParseDictRejectsUnknownForms(t *testing.T) {
	cases := map[string]string{
		"нет начала словаря": `export const x = {A: 'b'}`,
		"двойные кавычки": `const d = {
  A: "b",
}`,
		"шаблонная строка": "const d = {\n  A: `b`,\n}",
		"неизвестное экранирование": `const d = {
  A: 'b\qc',
}`,
		"незакрытая строка": `const d = {
  A: 'b,
}`,
		"объект не закрыт": `const d = {
  A: 'b',`,
		"значение-число": `const d = {
  A: 12,
}`,
	}
	for name, src := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parseDict(src); err == nil {
				t.Error("разбор прошёл; ожидалась ошибка")
			}
		})
	}
}

// Строка с формами без `other_value` на провод не записывается вовсе:
// `other_value` — единственный обязательный параметр конструктора.
func TestRecordRequiresOtherValue(t *testing.T) {
	_, err := record(pair{key: "K", forms: map[string]string{"one_value": "одна"}})
	if err == nil || !strings.Contains(err.Error(), "other_value") {
		t.Fatalf("ошибка = %v; ожидалась жалоба на other_value", err)
	}
}

// Форма с именем не из схемы — ошибка: `many_val` проехал бы молча и стал бы
// отсутствующей формой у пользователя.
func TestRecordRejectsUnknownForm(t *testing.T) {
	_, err := record(pair{key: "K", forms: map[string]string{"many_val": "x", "other_value": "y"}})
	if err == nil {
		t.Fatal("форма не из схемы принята")
	}
}

// Формы раскладываются ПОИМЁННО, а не по порядку.
func TestRecordAssignsFormsByName(t *testing.T) {
	rec, err := record(pair{key: "K", forms: map[string]string{
		"zero_value": "ноль", "one_value": "один", "two_value": "два",
		"few_value": "мало", "many_value": "много", "other_value": "прочее",
	}})
	if err != nil {
		t.Fatal(err)
	}
	f := *rec.Forms
	for name, got := range map[string]string{
		"zero_value": deref(f.Zero), "one_value": deref(f.One), "two_value": deref(f.Two),
		"few_value": deref(f.Few), "many_value": deref(f.Many), "other_value": f.Other,
	} {
		want := map[string]string{
			"zero_value": "ноль", "one_value": "один", "two_value": "два",
			"few_value": "мало", "many_value": "много", "other_value": "прочее",
		}[name]
		if got != want {
			t.Errorf("%s = %q; want %q", name, got, want)
		}
	}
}

// Пути к словарям — часть контракта снимка: переехавший файл обязан краснеть
// здесь, а не тихо выпадать из выдачи целым языком.
func TestSourceFilesExist(t *testing.T) {
	for _, src := range languageOrder {
		if _, err := os.Stat(filepath.Join(repoRoot, filepath.FromSlash(src.path))); err != nil {
			t.Errorf("%s (%s): %v", src.meta.Code, src.path, err)
		}
	}
}
