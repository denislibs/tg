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

// Language — язык вместе со своими строками и ВЕРСИЕЙ.
type Language struct {
	domain.LangPackLanguageMeta
	// Version — версия языкового пакета, и живёт она ЗДЕСЬ, а не в базе.
	//
	// Это не мелочь размещения, а условие работоспособности клиента. Клиент
	// принимает разницу, только если её `version` БОЛЬШЕ сохранённой у него
	// (tweb `langPack.ts:770-773`), и применяет её, только если его версия в
	// точности равна `from_version` (`:710-713`); иначе — «слишком длинно» и
	// повторный тот же запрос, то есть петля. Значит, версия сервера не имеет
	// права УМЕНЬШАТЬСЯ никогда.
	//
	// Считай её сид, она бы уменьшалась: `Down` роняет обе таблицы целиком
	// (миграция 0128), и после «откатили-накатили» сид начинал бы с единицы —
	// клиент, дошедший до пятой, не принял бы от сервера ни одной строки
	// больше НИКОГДА. Версия, приезжающая из снимка, переживает любой сброс
	// базы: она едет вместе с бинарём.
	//
	// Растит её генератор (Stamp), сравнивая свежие строки с предыдущим
	// снимком: перевод правится — версия +1, не правится — остаётся прежней.
	Version int `json:"version"`
	// Strings — строки языка В ПОРЯДКЕ ФАЙЛА. Порядок сохраняется не для
	// провода (там он не значит ничего), а для читаемости диффа снимка:
	// перегенерация после правки одной строки обязана давать правку одной
	// строки, иначе снимок нельзя перечитать глазами.
	Strings []domain.LangPackStringRecord `json:"strings"`
}

// SameStrings — совпадают ли строки двух языков (ключ в ключ, текст в текст).
//
// По этому ответу генератор решает, растить ли версию, и сравнение идёт КАК У
// КАРТЫ, а не как у списка: словарь адресуется ключом, порядок ключей в нём не
// значит ничего. Переставленные местами строки — правка ФАЙЛА (её видно в
// диффе снимка), но не правка словаря, и растить из-за неё версию значило бы
// послать каждому клиенту пустую разницу впустую.
func (l Language) SameStrings(o Language) bool {
	if len(l.Strings) != len(o.Strings) {
		return false
	}
	was := make(map[string]domain.LangPackStringRecord, len(o.Strings))
	for _, r := range o.Strings {
		was[r.Key] = r
	}
	for _, r := range l.Strings {
		old, known := was[r.Key]
		// `known` проверяется отдельно от текста: переименованный ключ — это
		// СНЯТИЕ старого и появление нового, и версия обязана вырасти, даже
		// если текст остался прежним.
		if !known || !r.SameText(old) {
			return false
		}
	}
	return true
}

// Stamp проставляет версии языков свежего снимка по предыдущему.
//
// Правило одно и оно всё: версия растёт РОВНО ТОГДА, когда изменились строки, и
// не уменьшается никогда. Новый язык начинает с единицы — нулевая версия
// означала бы «пакета нет», и клиент с нулём спросил бы весь пакет заново.
func Stamp(fresh, previous Pack) Pack {
	before := make(map[string]Language, len(previous.Languages))
	for _, l := range previous.Languages {
		before[l.Code] = l
	}
	for i, lang := range fresh.Languages {
		old, existed := before[lang.Code]
		switch {
		case !existed || old.Version < 1:
			// Новый язык — либо снимок, снятый до того, как версии появились
			// в нём вовсе. И то и другое начинается с единицы: нулевая версия
			// означает «пакета нет», клиент с нулём спрашивает весь пакет
			// заново, и отдать ему ноль значило бы зациклить его.
			fresh.Languages[i].Version = 1
		case lang.SameStrings(old):
			fresh.Languages[i].Version = old.Version
		default:
			fresh.Languages[i].Version = old.Version + 1
		}
	}
	return fresh
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

// languageOrder — порядок ВЫДАЧИ языков, и он же порядок этого списка.
//
// Список рисуется в том порядке, в каком его отдал сервер: у оригинала
// `langpack.getLanguages` перебирают `forEach` без всякой сортировки
// (tweb `sidebarLeft/tabs/language.tsx:115`). Значит, «предложенные первыми»
// обязан выразить СЕРВЕР, иначе их не выразит никто.
//
// Порядок: предложенные (английский, русский), затем по алфавиту английского
// имени — тот же, что на нынешнем экране настроек
// (`components/settings/LanguageSettings.tsx`), и менять его выдачей сервера
// было бы регрессом.
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

// Generate — весь путь генератора: разбор словарей клиента и простановка версий
// по предыдущему снимку. Ровно то, что пишет в файл `cmd/langpackgen`.
//
// Собран здесь, а не в самой команде, по одной причине: командой сторож снимка
// воспользоваться не может, а проверять он обязан ИМЕННО ТО, что пишет
// генератор. Разъедься они — снимок начал бы расходиться с файлами молча, а
// сторож продолжил бы зеленеть.
func Generate(root string, previous Pack) (Pack, error) {
	fresh, err := Extract(root)
	if err != nil {
		return Pack{}, err
	}
	return Stamp(fresh, previous), nil
}

// Extract читает словари клиента из репозитория (root — корень репозитория) и
// собирает снимок БЕЗ версий: их проставляет Stamp.
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

		meta := src.meta
		// Позиция в выдаче — порядок этого списка (см. languageOrder).
		meta.Position = i + 1
		lang := Language{LangPackLanguageMeta: meta}
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
