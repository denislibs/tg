package langsource

import (
	"fmt"
	"regexp"
	"strings"
)

// Разбор объектного литерала словаря — ровно того подмножества TypeScript, в
// котором записаны наши словари, и ни строчкой шире.
//
// Разбор СТРОГИЙ: всё, чего подмножество не описывает, — ошибка с номером
// строки, а не пропуск. Молчаливый пропуск здесь опаснее падения: он выглядел
// бы как «этой строки в языке нет», то есть как законное отсутствие перевода, и
// вылез бы у пользователя пустым местом на экране.
//
// Подмножество:
//
//	const <имя> = {
//	  Ключ: 'текст',
//	  'Ключ.С.Точками': 'текст',
//	  'Ключ.С.Числом': { one_value: 'текст', other_value: 'текст' },
//	} [satisfies ...]
//
// Строки только в одинарных кавычках (так их пишет наш линтер), экранирование —
// `\'`, `\\`, `\n`, `\t`, `\r`, `\"`. Комментарии `//` и `/* */` пропускаются.

// pair — одна запись словаря в порядке файла.
type pair struct {
	key string
	// str — значение-строка; nil, если значение было объектом форм.
	str *string
	// forms — значение-объект: имя формы → текст. Порядок форм не хранится:
	// формы адресуются ИМЕНЕМ, и их порядок в файле ничего не значит.
	forms map[string]string
	line  int
}

// начало литерала: `const <имя> = {` отдельной строкой (так записаны все шесть
// файлов). Требование «отдельной строкой» намеренно жёсткое — оно избавляет от
// поиска `{` в комментариях и строках выше по файлу.
var dictStart = regexp.MustCompile(`(?m)^const [A-Za-z_$][A-Za-z0-9_$]* = \{[ \t]*$`)

// parseDict читает первый объектный литерал, присвоенный `const`, из исходника.
func parseDict(src string) ([]pair, error) {
	loc := dictStart.FindStringIndex(src)
	if loc == nil {
		return nil, fmt.Errorf("не найдено начало словаря (`const <имя> = {` отдельной строкой)")
	}
	p := &parser{src: src, pos: loc[1], line: 1 + strings.Count(src[:loc[1]], "\n")}
	return p.object()
}

type parser struct {
	src  string
	pos  int
	line int
}

func (p *parser) errf(format string, args ...any) error {
	return fmt.Errorf("строка %d: "+format, append([]any{p.line}, args...)...)
}

// object читает содержимое объекта до закрывающей скобки (открывающая уже
// прочитана вызывающим).
func (p *parser) object() ([]pair, error) {
	var out []pair
	for {
		p.skipBlanks()
		if p.eof() {
			return nil, p.errf("объект не закрыт")
		}
		if p.peek() == '}' {
			p.next()
			return out, nil
		}

		line := p.line
		key, err := p.key()
		if err != nil {
			return nil, err
		}
		p.skipBlanks()
		if p.eof() || p.peek() != ':' {
			return nil, p.errf("после ключа %q ожидалось `:`", key)
		}
		p.next()
		p.skipBlanks()
		if p.eof() {
			return nil, p.errf("у ключа %q нет значения", key)
		}

		item := pair{key: key, line: line}
		switch p.peek() {
		case '\'':
			s, err := p.str()
			if err != nil {
				return nil, err
			}
			item.str = &s
		case '{':
			p.next()
			nested, err := p.object()
			if err != nil {
				return nil, err
			}
			item.forms = map[string]string{}
			for _, n := range nested {
				if n.str == nil {
					return nil, fmt.Errorf("строка %d: форма %q у ключа %q — не строка", n.line, n.key, key)
				}
				if _, dup := item.forms[n.key]; dup {
					return nil, fmt.Errorf("строка %d: форма %q у ключа %q объявлена дважды", n.line, n.key, key)
				}
				item.forms[n.key] = *n.str
			}
		default:
			return nil, p.errf("у ключа %q значение начинается с %q — ожидались строка или объект форм",
				key, string(p.peek()))
		}

		out = append(out, item)

		p.skipBlanks()
		if !p.eof() && p.peek() == ',' {
			p.next()
			continue
		}
		if !p.eof() && p.peek() == '}' {
			continue
		}
		return nil, p.errf("после значения ключа %q ожидались `,` или `}`", key)
	}
}

// key читает ключ: голый идентификатор либо строка в кавычках.
func (p *parser) key() (string, error) {
	if p.peek() == '\'' {
		return p.str()
	}
	start := p.pos
	for !p.eof() {
		c := p.peek()
		if c == '_' || c == '$' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' {
			p.next()
			continue
		}
		break
	}
	if p.pos == start {
		return "", p.errf("ожидался ключ, а начинается он с %q", string(p.peek()))
	}
	return p.src[start:p.pos], nil
}

// str читает строку в одинарных кавычках вместе с экранированием.
func (p *parser) str() (string, error) {
	p.next() // открывающая кавычка
	var b strings.Builder
	for {
		if p.eof() {
			return "", p.errf("строка не закрыта")
		}
		c := p.next()
		switch c {
		case '\'':
			return b.String(), nil
		case '\n':
			// В JS перевод строки внутри одинарных кавычек — ошибка. Ловим её
			// здесь же, иначе незакрытая кавычка съела бы полфайла.
			return "", p.errf("перевод строки внутри строкового литерала")
		case '\\':
			if p.eof() {
				return "", p.errf("строка обрывается на экранировании")
			}
			esc := p.next()
			switch esc {
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case 'r':
				b.WriteByte('\r')
			case '\'', '"', '\\', '`', '/':
				b.WriteByte(esc)
			default:
				return "", p.errf("неизвестное экранирование \\%s", string(esc))
			}
		default:
			b.WriteByte(c)
		}
	}
}

// skipBlanks пропускает пробелы, переводы строк и комментарии обоих видов.
func (p *parser) skipBlanks() {
	for !p.eof() {
		c := p.peek()
		switch {
		case c == ' ' || c == '\t' || c == '\r' || c == '\n':
			p.next()
		case c == '/' && p.pos+1 < len(p.src) && p.src[p.pos+1] == '/':
			for !p.eof() && p.peek() != '\n' {
				p.next()
			}
		case c == '/' && p.pos+1 < len(p.src) && p.src[p.pos+1] == '*':
			p.next()
			p.next()
			for !p.eof() {
				if p.peek() == '*' && p.pos+1 < len(p.src) && p.src[p.pos+1] == '/' {
					p.next()
					p.next()
					break
				}
				p.next()
			}
		default:
			return
		}
	}
}

func (p *parser) eof() bool  { return p.pos >= len(p.src) }
func (p *parser) peek() byte { return p.src[p.pos] }

// next отдаёт байт и двигает позицию. Байт, а не руну: разбор ведётся по
// ASCII-структуре (кавычки, скобки, слеши), а текст между ними переносится в
// вывод как есть — UTF-8 при побайтовом копировании не портится.
func (p *parser) next() byte {
	c := p.src[p.pos]
	p.pos++
	if c == '\n' {
		p.line++
	}
	return c
}
