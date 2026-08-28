package demoseed

import (
	"strings"
	"unicode/utf16"

	"github.com/messenger-denis/backend/internal/domain"
)

// Кусок текста поста. Разметка описывается кусками, а не руками посчитанными
// offset/length: единица смещения MessageEntity — кодовая единица UTF-16, и
// считать её вручную для двух сотен постов — гарантированная ошибка.
type run struct {
	text string
	kind string // "" — без разметки
	arg  string // язык для pre, url для link
}

const (
	kindBold      = "bold"
	kindItalic    = "italic"
	kindUnderline = "underline"
	kindStrike    = "strike"
	kindCode      = "code"
	kindPre       = "pre"
	kindSpoiler   = "spoiler"
	kindQuote     = "quote"
	kindLink      = "link"
)

func tx(s string) run { return run{text: s} }
func bo(s string) run { return run{text: s, kind: kindBold} }
func it(s string) run { return run{text: s, kind: kindItalic} }
func un(s string) run { return run{text: s, kind: kindUnderline} }
func st(s string) run { return run{text: s, kind: kindStrike} }
func cd(s string) run { return run{text: s, kind: kindCode} }
func sp(s string) run { return run{text: s, kind: kindSpoiler} }
func qt(s string) run { return run{text: s, kind: kindQuote} }

func pre(s, lang string) run { return run{text: s, kind: kindPre, arg: lang} }

func ln(s, url string) run { return run{text: s, kind: kindLink, arg: url} }

// utf16Len — длина строки в кодовых единицах UTF-16 (единица смещения сущности).
func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// compose склеивает куски в текст сообщения и набор сущностей поверх него.
func compose(runs []run) (string, domain.MessageEntities) {
	var sb strings.Builder
	var es domain.MessageEntities
	off := 0
	for _, r := range runs {
		n := utf16Len(r.text)
		if n > 0 {
			switch r.kind {
			case kindBold:
				es = append(es, domain.NewMessageEntityBold(off, n))
			case kindItalic:
				es = append(es, domain.NewMessageEntityItalic(off, n))
			case kindUnderline:
				es = append(es, domain.NewMessageEntityUnderline(off, n))
			case kindStrike:
				es = append(es, domain.NewMessageEntityStrike(off, n))
			case kindCode:
				es = append(es, domain.NewMessageEntityCode(off, n))
			case kindPre:
				es = append(es, domain.NewMessageEntityPre(off, n, r.arg))
			case kindSpoiler:
				es = append(es, domain.NewMessageEntitySpoiler(off, n))
			case kindQuote:
				es = append(es, domain.NewMessageEntityBlockquote(off, n, false))
			case kindLink:
				es = append(es, domain.NewMessageEntityTextURL(off, n, r.arg))
			}
		}
		sb.WriteString(r.text)
		off += n
	}
	return sb.String(), es
}
