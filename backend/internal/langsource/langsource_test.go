package langsource

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
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
// Тест прогоняет генератор целиком — разбор словарей и простановку версий — и
// сравнивает результат с вшитым файлом. Красит и правку перевода без
// `go run ./cmd/langpackgen`, и снимок, которому забыли поднять версию.
func TestSnapshotMatchesDictionaries(t *testing.T) {
	embedded, err := Embedded()
	if err != nil {
		t.Fatalf("вшитый снимок не читается: %v", err)
	}
	// Прогоняется ИМЕННО генератор (Generate), а не пересобранные здесь его
	// шаги: копия шагов зеленела бы и тогда, когда генератор перестал бы делать
	// один из них.
	fresh, err := Generate(repoRoot, embedded)
	if err != nil {
		t.Fatalf("словари клиента не читаются: %v", err)
	}

	if len(fresh.Languages) != len(embedded.Languages) {
		t.Fatalf("в снимке %d языков, в словарях %d — перегенерируй: go run ./cmd/langpackgen",
			len(embedded.Languages), len(fresh.Languages))
	}
	for i, want := range fresh.Languages {
		got := embedded.Languages[i]
		if got.LangPackLanguageMeta != want.LangPackLanguageMeta {
			t.Errorf("паспорт языка %s разошёлся: снимок %+v, словари %+v",
				want.Code, got.LangPackLanguageMeta, want.LangPackLanguageMeta)
			continue
		}
		if got.Version != want.Version {
			t.Errorf("%s: в снимке версия %d, словари требуют %d — перегенерируй: go run ./cmd/langpackgen",
				want.Code, got.Version, want.Version)
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

// Версия языка есть у каждого и начинается с единицы.
//
// Ноль означает «пакета нет»: клиент с нулём спрашивает весь пакет заново, и
// сервер, ответивший нулём, зациклил бы его.
func TestSnapshotVersionsAreReal(t *testing.T) {
	pack, err := Embedded()
	if err != nil {
		t.Fatalf("снимок не читается: %v", err)
	}
	for _, lang := range pack.Languages {
		if lang.Version < 1 {
			t.Errorf("%s: версия %d; версия языка начинается с единицы", lang.Code, lang.Version)
		}
	}
}

// Порядок выдачи задан ИСТОЧНИКОМ: предложенные (английский, русский), затем по
// алфавиту английского имени — тот же порядок, что на нынешнем экране настроек.
//
// Выразить его обязан сервер: клиент рисует список перебором выдачи и не
// сортирует (tweb `sidebarLeft/tabs/language.tsx:117`). Русский на четвёртом
// месте — регресс относительно того, что пользователь видит сегодня.
func TestSnapshotLanguageOrder(t *testing.T) {
	pack, err := Embedded()
	if err != nil {
		t.Fatalf("снимок не читается: %v", err)
	}
	var codes []string
	for i, lang := range pack.Languages {
		codes = append(codes, lang.Code)
		if lang.Position != i+1 {
			t.Errorf("%s: позиция %d на месте %d", lang.Code, lang.Position, i+1)
		}
	}
	if got := strings.Join(codes, ","); got != "en,ru,fr,de,es,uk" {
		t.Errorf("порядок языков = %s; want en,ru,fr,de,es,uk (предложенные, затем алфавит)", got)
	}
}

// ── Версионирование ─────────────────────────────────────────────────────────

func langWith(code string, version int, recs ...domain.LangPackStringRecord) Language {
	return Language{
		LangPackLanguageMeta: domain.LangPackLanguageMeta{Code: code},
		Version:              version,
		Strings:              recs,
	}
}

func rec(key, value string) domain.LangPackStringRecord {
	v := value
	return domain.LangPackStringRecord{Key: key, Value: &v}
}

// Версия растёт РОВНО ТОГДА, когда изменились строки, и не уменьшается никогда.
//
// Цена ошибки здесь — замёрзший навсегда клиент: он применяет разницу, только
// если её версия больше сохранённой у него (tweb `langPack.ts:770-773`), и
// применяет её, только если его версия в точности равна `from_version`
// (`:710-713`), иначе уходит в петлю «слишком длинно».
func TestStampGrowsVersionOnlyOnChange(t *testing.T) {
	previous := Pack{Languages: []Language{
		langWith("en", 7, rec("Add", "Add"), rec("Cancel", "Cancel")),
		langWith("ru", 3, rec("Add", "Добавить")),
	}}

	cases := []struct {
		name  string
		fresh Language
		want  int
	}{
		{"строки те же — версия та же", langWith("en", 0, rec("Add", "Add"), rec("Cancel", "Cancel")), 7},
		{"текст изменился — версия +1", langWith("en", 0, rec("Add", "Add to contacts"), rec("Cancel", "Cancel")), 8},
		{"ключ исчез — версия +1", langWith("en", 0, rec("Add", "Add")), 8},
		{"ключ добавился — версия +1", langWith("en", 0, rec("Add", "Add"), rec("Cancel", "Cancel"), rec("Delete", "Delete")), 8},
		{"ключ переименован — версия +1", langWith("en", 0, rec("Add", "Add"), rec("Cancelled", "Cancel")), 8},
		{"новый язык начинает с единицы", langWith("de", 0, rec("Add", "Hinzufügen")), 1},
		// Словарь адресуется ключом: перестановка строк местами — правка файла,
		// но не словаря, и гонять из-за неё пустую разницу по всем клиентам
		// незачем.
		{"строки переставлены местами — версия та же", langWith("en", 0, rec("Cancel", "Cancel"), rec("Add", "Add")), 7},
		// Ключи с ОДИНАКОВЫМ текстом: здесь позиционное сравнение не заметило
		// бы ничего, а сравнение по ключу — единственное, что вообще работает.
		{"ключ с тем же текстом переименован — версия +1",
			langWith("en", 0, rec("Add", "Add"), rec("Cancel2", "Cancel")), 8},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Stamp(Pack{Languages: []Language{tc.fresh}}, previous)
			if got.Languages[0].Version != tc.want {
				t.Errorf("версия = %d; want %d", got.Languages[0].Version, tc.want)
			}
		})
	}
}

// Формы числа сравниваются поформенно: правка ОДНОЙ формы — это изменение
// строки. Иначе перевод во множественном числе не доехал бы до клиента никогда.
func TestStampSeesChangedPluralForm(t *testing.T) {
	forms := func(many string) domain.LangPackStringRecord {
		m := many
		return domain.LangPackStringRecord{Key: "N", Forms: &domain.PluralForms{Many: &m, Other: "прочее"}}
	}
	previous := Pack{Languages: []Language{langWith("ru", 4, forms("уведомлений"))}}

	same := Stamp(Pack{Languages: []Language{langWith("ru", 0, forms("уведомлений"))}}, previous)
	if same.Languages[0].Version != 4 {
		t.Errorf("версия при неизменных формах = %d; want 4", same.Languages[0].Version)
	}
	changed := Stamp(Pack{Languages: []Language{langWith("ru", 0, forms("уведомлениев"))}}, previous)
	if changed.Languages[0].Version != 5 {
		t.Errorf("версия при правке формы = %d; want 5", changed.Languages[0].Version)
	}
}

// Снимок, снятый до появления версий (версия 0), поднимается до единицы, а не
// остаётся нулём: ноль клиент читает как «пакета нет».
func TestStampLiftsUnversionedSnapshot(t *testing.T) {
	previous := Pack{Languages: []Language{langWith("en", 0, rec("Add", "Add"))}}
	got := Stamp(Pack{Languages: []Language{langWith("en", 0, rec("Add", "Add"))}}, previous)
	if got.Languages[0].Version != 1 {
		t.Errorf("версия = %d; want 1", got.Languages[0].Version)
	}
}

// ── Правила разбора словарей на живых файлах ────────────────────────────────

// Английский — БАЗА: каждый переведённый ключ обязан в нём быть, иначе перевод
// мёртв (клиент такой ключ не спросит никогда).
func TestExtractedTranslationsDeclareBase(t *testing.T) {
	pack, err := Extract(repoRoot)
	if err != nil {
		t.Fatalf("словари не читаются: %v", err)
	}
	if pack.Languages[0].Code != "en" || pack.Languages[0].BaseCode != "" {
		t.Fatalf("базой идёт %+v; ожидался en без своей базы", pack.Languages[0].LangPackLanguageMeta)
	}
	for _, lang := range pack.Languages[1:] {
		if lang.BaseCode != "en" {
			t.Errorf("%s: база %q, а недостающие строки берутся из английского", lang.Code, lang.BaseCode)
		}
		// Перевод НЕПОЛНЫЙ — это не дефект, а факт, на котором стоит вся
		// подсистема базы; равенство означало бы, что счётчик «переведено из»
		// потерял смысл.
		if len(lang.Strings) >= len(pack.Languages[0].Strings) {
			t.Errorf("%s: строк %d при %d в базе — перевод обязан быть подмножеством",
				lang.Code, len(lang.Strings), len(pack.Languages[0].Strings))
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

// ── Правила разбора на подставном дереве ────────────────────────────────────
//
// На живых словарях эти правила не проверяются: там они СОБЛЮДЕНЫ, и утверждение
// «нарушения нет» выполняется само собой, ничего не проверяя. Поэтому нарушение
// строится нарочно — из подставного каталога с теми же путями.

// fakeRoot собирает дерево `web-client/src/...` с подставными словарями.
// dicts — содержимое объекта каждого перевода (ключ — код языка).
func fakeRoot(t *testing.T, base string, dicts map[string]string) string {
	t.Helper()
	root := t.TempDir()
	write := func(rel, body string) {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for i, src := range languageOrder {
		body := dicts[src.meta.Code]
		if i == 0 {
			body = base
		}
		write(src.path, "const d = {\n"+body+"}\n")
	}
	return root
}

// Ключ, которого нет в английском источнике, — ошибка разбора, а не пропуск.
//
// Молча пропущенный, он выглядел бы как «перевода нет»: клиент такой ключ не
// спросит никогда, а переводчик будет уверен, что строка на месте.
func TestExtractRejectsKeyMissingFromBase(t *testing.T) {
	root := fakeRoot(t, "  Add: 'Add',\n", map[string]string{
		"ru": "  Add: 'Добавить',\n  Ghost: 'Призрак',\n",
	})
	_, err := Extract(root)
	if err == nil {
		t.Fatal("перевод с ключом не из базы принят")
	}
	if !strings.Contains(err.Error(), "Ghost") {
		t.Errorf("ошибка не называет ключ-сироту: %v", err)
	}
}

// Вид значения обязан совпасть с английским: где у базы формы числа, там формы
// и у перевода. Плоская строка на месте форм показала бы «%d» буквой, а формы
// на месте плоской строки — выбор формы там, где выбирать нечего.
func TestExtractRejectsShapeMismatch(t *testing.T) {
	root := fakeRoot(t, "  N: { one_value: 'one', other_value: 'many' },\n", map[string]string{
		"ru": "  N: 'просто строка',\n",
	})
	if _, err := Extract(root); err == nil {
		t.Fatal("перевод другого вида принят")
	}

	root = fakeRoot(t, "  N: 'просто строка',\n", map[string]string{
		"ru": "  N: { one_value: 'одна', other_value: 'много' },\n",
	})
	if _, err := Extract(root); err == nil {
		t.Fatal("формы числа на месте плоской строки приняты")
	}
}

// Один ключ дважды в одном словаре — ошибка: в JS побеждает последний, и
// «исправленный» перевод молча проигрывал бы забытому выше.
func TestExtractRejectsDuplicateKey(t *testing.T) {
	root := fakeRoot(t, "  Add: 'Add',\n", map[string]string{
		"ru": "  Add: 'Добавить',\n  Add: 'Добавить ещё',\n",
	})
	if _, err := Extract(root); err == nil {
		t.Fatal("повторённый ключ принят")
	}
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
	want := map[string]string{
		"zero_value": "ноль", "one_value": "один", "two_value": "два",
		"few_value": "мало", "many_value": "много", "other_value": "прочее",
	}
	got, err := record(pair{key: "K", forms: want})
	if err != nil {
		t.Fatal(err)
	}
	f := *got.Forms
	for name, have := range map[string]string{
		"zero_value": deref(f.Zero), "one_value": deref(f.One), "two_value": deref(f.Two),
		"few_value": deref(f.Few), "many_value": deref(f.Many), "other_value": f.Other,
	} {
		if have != want[name] {
			t.Errorf("%s = %q; want %q", name, have, want[name])
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
