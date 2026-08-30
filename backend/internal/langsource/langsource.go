// Package langsource — СНИМОК словарей клиента для сервера.
//
// Переводы существуют в одном месте — в файлах веб-клиента (`src/lang.ts` и
// `src/i18n/dict.*.ts`). Сервер обязан отдавать те же строки, но взять их
// оттуда напрямую он не может: в образе бэкенда каталога `web-client/` нет
// вовсе (контекст сборки — `backend/`). Поэтому здесь лежит СНИМОК, снятый с
// тех же файлов и вшитый в бинарь (`langpack.gen.json`).
//
// Снимок — это копия, и копия расходится с оригиналом молча. Поэтому рядом
// живёт сторож: `TestSnapshotMatchesDictionaries` заново читает те же .ts тем же
// кодом и сравнивает с вшитым файлом. Правка перевода без перегенерации красит
// тест — рассинхрон не «маловероятен», он ЗАМЕЧЕН.
//
// Перегенерация: `go run ./cmd/langpackgen` из каталога backend.
package langsource

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/messenger-denis/backend/internal/domain"
)

// Language — язык вместе со своими строками.
type Language struct {
	domain.LangPackLanguageMeta
	// Strings — строки языка В ПОРЯДКЕ ФАЙЛА. Порядок сохраняется не для
	// провода (там он не значит ничего), а для читаемости диффа снимка:
	// перегенерация после правки одной строки обязана давать правку одной
	// строки, иначе снимок нельзя перечитать глазами.
	Strings []domain.LangPackStringRecord `json:"strings"`
}

// Pack — все языки снимка.
type Pack struct {
	Languages []Language `json:"languages"`
}

//go:embed langpack.gen.json
var snapshot []byte

// Embedded отдаёт вшитый снимок.
func Embedded() (Pack, error) {
	var p Pack
	if err := json.Unmarshal(snapshot, &p); err != nil {
		return Pack{}, fmt.Errorf("langsource: снимок не разбирается: %w", err)
	}
	return p, nil
}

// sourceFile — язык и файл, в котором лежат его строки.
//
// Паспорта языков (английское имя, самоназвание) живут ЗДЕСЬ, а не извлекаются
// из клиента, и это осознанно. В клиенте они лежат в списке экрана настроек
// (`components/settings/LanguageSettings.tsx`) вперемешку с тремя десятками
// языков, которых у нас нет; список этот — временный, его заменит выдача
// `langpack.getLanguages` (задача 5). Переводы оттуда не берутся ни одной
// строкой: паспорт это шесть имён языков, а не корпус текстов.
type sourceFile struct {
	meta domain.LangPackLanguageMeta
	path string
}

// languageOrder — порядок выдачи: сначала предложенные (английский, русский),
// затем по алфавиту английского имени. Тот же порядок, что у оригинала и у
// нынешнего экрана настроек.
var languageOrder = []sourceFile{
	{
		// Английский — БАЗА: его файл и есть источник ключей, все остальные
		// словари переводят подмножество этих ключей.
		meta: domain.LangPackLanguageMeta{Code: "en", Name: "English", NativeName: "English", PluralCode: "en"},
		path: "web-client/src/lang.ts",
	},
	{
		meta: domain.LangPackLanguageMeta{Code: "ru", Name: "Russian", NativeName: "Русский", PluralCode: "ru", BaseCode: "en"},
		path: "web-client/src/i18n/dict.ru.ts",
	},
	{
		meta: domain.LangPackLanguageMeta{Code: "fr", Name: "French", NativeName: "Français", PluralCode: "fr", BaseCode: "en"},
		path: "web-client/src/i18n/dict.fr.ts",
	},
	{
		meta: domain.LangPackLanguageMeta{Code: "de", Name: "German", NativeName: "Deutsch", PluralCode: "de", BaseCode: "en"},
		path: "web-client/src/i18n/dict.de.ts",
	},
	{
		meta: domain.LangPackLanguageMeta{Code: "es", Name: "Spanish", NativeName: "Español", PluralCode: "es", BaseCode: "en"},
		path: "web-client/src/i18n/dict.es.ts",
	},
	{
		meta: domain.LangPackLanguageMeta{Code: "uk", Name: "Ukrainian", NativeName: "Українська", PluralCode: "uk", BaseCode: "en"},
		path: "web-client/src/i18n/dict.uk.ts",
	},
}

// formParams — имена форм числа, какими их называет схема. Форма с другим
// именем — ошибка, а не пропуск: `many_val` проехал бы молча и стал бы
// отсутствующей формой у пользователя.
var formParams = map[string]bool{
	"zero_value": true, "one_value": true, "two_value": true,
	"few_value": true, "many_value": true, "other_value": true,
}

// Extract читает словари клиента из репозитория (root — корень репозитория) и
// собирает снимок.
func Extract(root string) (Pack, error) {
	var pack Pack
	// base — ключи английского вместе с их ВИДОМ (строка или формы). По нему
	// сверяется каждый перевод: ключа нет в базе — перевод мёртв, вид не
	// совпал — данные врут о самих себе.
	base := map[string]bool{}

	for i, src := range languageOrder {
		raw, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(src.path)))
		if err != nil {
			return Pack{}, fmt.Errorf("langsource: %s: %w", src.path, err)
		}
		pairs, err := parseDict(string(raw))
		if err != nil {
			return Pack{}, fmt.Errorf("langsource: %s: %w", src.path, err)
		}

		lang := Language{LangPackLanguageMeta: src.meta}
		seen := map[string]bool{}
		for _, p := range pairs {
			if seen[p.key] {
				return Pack{}, fmt.Errorf("langsource: %s:%d: ключ %q объявлен дважды", src.path, p.line, p.key)
			}
			seen[p.key] = true

			rec, err := record(p)
			if err != nil {
				return Pack{}, fmt.Errorf("langsource: %s:%d: %w", src.path, p.line, err)
			}
			if i == 0 {
				base[p.key] = rec.Forms != nil
			} else {
				plural, known := base[p.key]
				if !known {
					return Pack{}, fmt.Errorf("langsource: %s:%d: ключа %q нет в английском источнике — перевод мёртв",
						src.path, p.line, p.key)
				}
				if plural != (rec.Forms != nil) {
					return Pack{}, fmt.Errorf("langsource: %s:%d: у ключа %q вид значения не совпал с английским "+
						"(формы числа против простой строки)", src.path, p.line, p.key)
				}
			}
			lang.Strings = append(lang.Strings, rec)
		}
		pack.Languages = append(pack.Languages, lang)
	}
	return pack, nil
}

// record переводит разобранную пару в запись строки.
func record(p pair) (domain.LangPackStringRecord, error) {
	if p.str != nil {
		value := *p.str
		return domain.LangPackStringRecord{Key: p.key, Value: &value}, nil
	}

	names := make([]string, 0, len(p.forms))
	for name := range p.forms {
		if !formParams[name] {
			return domain.LangPackStringRecord{}, fmt.Errorf("у ключа %q форма %q не объявлена схемой", p.key, name)
		}
		names = append(names, name)
	}
	sort.Strings(names)

	var forms domain.PluralForms
	other, hasOther := p.forms["other_value"]
	if !hasOther {
		// `other_value` — единственный обязательный параметр конструктора: это
		// форма, которой язык закрывает всё остальное. Без неё строка не
		// записывается на провод вовсе.
		return domain.LangPackStringRecord{}, fmt.Errorf("у ключа %q нет обязательной формы other_value (есть %v)", p.key, names)
	}
	forms.Other = other
	// Каждая форма присваивается ПОИМЁННО. Ни цикла по позициям, ни списка —
	// иначе перестановка двух строк местами меняет смысл данных и не ловится
	// ничем.
	if v, ok := p.forms["zero_value"]; ok {
		forms.Zero = &v
	}
	if v, ok := p.forms["one_value"]; ok {
		forms.One = &v
	}
	if v, ok := p.forms["two_value"]; ok {
		forms.Two = &v
	}
	if v, ok := p.forms["few_value"]; ok {
		forms.Few = &v
	}
	if v, ok := p.forms["many_value"]; ok {
		forms.Many = &v
	}
	return domain.LangPackStringRecord{Key: p.key, Forms: &forms}, nil
}

// Marshal сериализует снимок в тот же вид, в каком он лежит файлом: с отступами
// и переводом строки в конце. Пользуются двое — генератор (пишет файл) и
// сторож (сравнивает с файлом), и вид обязан быть один.
func Marshal(p Pack) ([]byte, error) {
	raw, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}
