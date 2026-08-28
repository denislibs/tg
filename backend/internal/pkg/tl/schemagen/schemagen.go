// Package schemagen печатает таблицу конструкторов TL для Go по общей схеме
// (`schema/schema.json` в корне репозитория).
//
// Зачем генерация, а не чтение схемы в рантайме: кодек нужен и серверу в
// контейнере, где корня репозитория нет вовсе, а тащить схему файлом в образ —
// значит завести второй экземпляр источника, который разъедется молча.
// Напечатанная таблица — тот же приём, что у оригинала: tweb генерирует из этой
// же схемы `lib/mtproto/schema.ts` и `layer.d.ts`.
//
// Дрейф ловит пин `tl.TestSchemaTableMatchesSchema`: таблица печатается заново
// и сравнивается с закоммиченной — правка руками краснеет.
package schemagen

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/format"
	"regexp"
	"strconv"
	"strings"
)

// rawConstructor — запись схемы в том виде, в каком она лежит в файлах.
//
// `id` строкой, а не числом: значения не влезают в int32 знаково и в исходнике
// записаны как «-1881881384». У клиентских конструкторов из
// `schema_additional_params.json` id нет вовсе — они на провод не идут.
type rawConstructor struct {
	ID         string     `json:"id"`
	Predicate  string     `json:"predicate"`
	Type       string     `json:"type"`
	Params     []rawParam `json:"params"`
	Properties []rawParam `json:"properties"`
}

type rawParam struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type rawSchema struct {
	Layer int `json:"layer"`
	API   struct {
		Constructors []rawConstructor `json:"constructors"`
	} `json:"API"`
}

// optionalRe разбирает префикс необязательности: `flags.7?Vector<PhotoSize>`.
// Масок в конструкторе бывает две (`flags` и `flags2` — например у `message`),
// поэтому имя маски тоже часть разбора, а не константа.
var optionalRe = regexp.MustCompile(`^(flags2?)\.(\d+)\?(.+)$`)

// boxedRe — имя типа-объединения, при необходимости с пространством
// (`Document`, `messages.StickerSet`).
var boxedRe = regexp.MustCompile(`^([a-z][A-Za-z0-9_]*\.)?[A-Z][A-Za-z0-9_]*$`)

// Generate печатает содержимое `backend/internal/pkg/tl/schema_gen.go`.
func Generate(schemaJSON, additionalJSON []byte) ([]byte, error) {
	var schema rawSchema
	if err := json.Unmarshal(schemaJSON, &schema); err != nil {
		return nil, fmt.Errorf("schema.json: %w", err)
	}
	var additional []rawConstructor
	if err := json.Unmarshal(additionalJSON, &additional); err != nil {
		return nil, fmt.Errorf("schema_additional_params.json: %w", err)
	}

	wireNames := make(map[string]map[string]bool, len(schema.API.Constructors))
	for _, c := range schema.API.Constructors {
		names := make(map[string]bool, len(c.Params))
		for _, p := range c.Params {
			names[p.Name] = true
		}
		wireNames[c.Predicate] = names
	}

	var buf bytes.Buffer
	buf.WriteString(header(schema.Layer))

	buf.WriteString("var schemaConstructors = []Constructor{\n")
	for _, c := range schema.API.Constructors {
		line, err := constructorLiteral(c)
		if err != nil {
			return nil, err
		}
		buf.WriteString(line)
	}
	// Конструкторы, объявленные нами: в схеме оригинала их нет, а на проводе
	// они есть — значит и id у них есть, назначенный явно (см. tl-program.md,
	// «Наши собственные сущности»).
	for _, c := range additional {
		if c.ID == "" {
			continue
		}
		line, err := constructorLiteral(c)
		if err != nil {
			return nil, err
		}
		buf.WriteString(line)
	}
	buf.WriteString("}\n\n")

	buf.WriteString(clientOnlySection(additional))
	buf.WriteString(clientParamsSection(additional, wireNames))

	out, err := format.Source(buf.Bytes())
	if err != nil {
		return nil, fmt.Errorf("напечатанный файл не форматируется: %w", err)
	}
	return out, nil
}

func header(layer int) string {
	return fmt.Sprintf(`// Код напечатан cmd/tl-schemagen по schema/schema.json. РУКАМИ НЕ ПРАВИТЬ.
//
// Таблица — единственное, что кодек знает о конструкторах: числовой id, порядок
// параметров, их типы и позиции битов в маске. Всё остальное (значения) даёт
// модель, а совпадение модели со схемой проверяется отдельно — сверками
// *_schema_test.go на обеих сторонах провода.

package tl

// schemaLayer — слой схемы, из которой напечатана таблица.
const schemaLayer = %d

`, layer)
}

// constructorLiteral печатает одну запись таблицы.
func constructorLiteral(c rawConstructor) (string, error) {
	id, err := strconv.ParseInt(c.ID, 10, 64)
	if err != nil {
		return "", fmt.Errorf("%s: id %q не число: %w", c.Predicate, c.ID, err)
	}
	if id < -2147483648 || id > 4294967295 {
		return "", fmt.Errorf("%s: id %d не влезает в 32 бита", c.Predicate, id)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "\t{ID: %d, Predicate: %q, Type: %q", int32(id), c.Predicate, c.Type)
	if len(c.Params) == 0 {
		b.WriteString("},\n")
		return b.String(), nil
	}

	b.WriteString(", Params: []Param{\n")
	for _, p := range c.Params {
		param, err := parseParam(c.Predicate, p)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "\t\t{Name: %q, Type: %q", param.name, param.typ)
		if param.flags != "" {
			fmt.Fprintf(&b, ", Flags: %q, Bit: %d", param.flags, param.bit)
		}
		b.WriteString("},\n")
	}
	b.WriteString("\t}},\n")
	return b.String(), nil
}

type parsedParam struct {
	name  string
	typ   string
	flags string
	bit   uint
}

func parseParam(predicate string, p rawParam) (parsedParam, error) {
	out := parsedParam{name: p.Name, typ: p.Type}
	if m := optionalRe.FindStringSubmatch(p.Type); m != nil {
		bit, err := strconv.Atoi(m[2])
		if err != nil {
			return out, fmt.Errorf("%s.%s: позиция бита %q: %w", predicate, p.Name, m[2], err)
		}
		out.flags, out.bit, out.typ = m[1], uint(bit), m[3]
	}
	if err := checkWireType(out.typ); err != nil {
		return out, fmt.Errorf("%s.%s: %w", predicate, p.Name, err)
	}
	if out.typ == "true" && out.flags == "" {
		// `true` не занимает на проводе ничего: значение выражено битом маски,
		// поэтому вне маски параметр такого типа невыразим.
		return out, fmt.Errorf("%s.%s: тип true без маски", predicate, p.Name)
	}
	return out, nil
}

// checkWireType отвергает типы, которых на проводе не бывает.
//
// Проверка нужна нашим конструкторам: у клиентских записей типы записаны
// по-тайпскриптовому (`number`, `Array<UserId>`), и объявить такой у идущего на
// провод конструктора значит получить неразбираемые байты.
func checkWireType(t string) error {
	switch t {
	case "#", "int", "long", "double", "string", "bytes", "Bool", "true":
		return nil
	}
	if inner, ok := strings.CutPrefix(t, "Vector<"); ok {
		inner, ok = strings.CutSuffix(inner, ">")
		if !ok {
			return fmt.Errorf("тип %q: незакрытый Vector", t)
		}
		return checkWireType(inner)
	}
	if boxedRe.MatchString(t) {
		return nil
	}
	return fmt.Errorf("тип %q на проводе не выражается", t)
}

// clientOnlySection перечисляет конструкторы, объявленные без id.
//
// Это клиентские псевдо-конструкторы оригинала (`messageEntityCaret`,
// `messageActionChatJoined` и прочие): предмета на проводе у них нет, id им
// никто не назначал. Кодек обязан отвечать про них внятно, а не «нет такого
// конструктора» — иначе первый же вопрос будет «а почему схема его знает».
func clientOnlySection(additional []rawConstructor) string {
	var b strings.Builder
	b.WriteString("// clientOnlyPredicates — конструкторы, объявленные только для клиента:\n")
	b.WriteString("// id у них нет, на провод они не идут.\n")
	b.WriteString("var clientOnlyPredicates = map[string]bool{\n")
	for _, c := range additional {
		if c.ID == "" && c.Type != "" {
			fmt.Fprintf(&b, "\t%q: true,\n", c.Predicate)
		}
	}
	b.WriteString("}\n\n")
	return b.String()
}

// clientParamsSection перечисляет поля, которых на проводе нет.
//
// Имена, объявленные и в схеме тоже (`document.size`, `document.thumbs`), сюда
// НЕ попадают: там клиентская запись лишь уточняет тип для TypeScript, а поле
// остаётся проводным.
func clientParamsSection(additional []rawConstructor, wireNames map[string]map[string]bool) string {
	var b strings.Builder
	b.WriteString("// clientParams — поля модели, которых на проводе нет вовсе\n")
	b.WriteString("// (schema/schema_additional_params.json). Кодек их пропускает, а всё\n")
	b.WriteString("// остальное незнакомое — отвергает.\n")
	b.WriteString("var clientParams = map[string][]string{\n")

	// Один конструктор объявляют и несколькими записями (у оригинала так у
	// `replyKeyboardForceReply`), поэтому имена собираются, а не печатаются
	// сразу: иначе в литерале карты вышел бы повторный ключ.
	var order []string
	merged := map[string][]string{}
	for _, c := range additional {
		if c.Type != "" {
			// Запись объявляет конструктор целиком: с id — наш, проводной, у
			// него все поля проводные; без id — клиентский, он перечислен
			// отдельно, и разбирать его поля по одному незачем.
			continue
		}
		wire := wireNames[c.Predicate]
		for _, p := range append(append([]rawParam{}, c.Params...), c.Properties...) {
			if wire[p.Name] {
				continue
			}
			if _, seen := merged[c.Predicate]; !seen {
				order = append(order, c.Predicate)
			}
			merged[c.Predicate] = append(merged[c.Predicate], p.Name)
		}
	}

	for _, predicate := range order {
		fmt.Fprintf(&b, "\t%q: {", predicate)
		for i, n := range merged[predicate] {
			if i > 0 {
				b.WriteString(", ")
			}
			fmt.Fprintf(&b, "%q", n)
		}
		b.WriteString("},\n")
	}
	b.WriteString("}\n")
	return b.String()
}
