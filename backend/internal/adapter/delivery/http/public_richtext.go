package http

import (
	"html"
	"html/template"
	"net/url"
	"sort"
	"strings"
	"unicode/utf16"

	"github.com/messenger-denis/backend/internal/domain"
)

// Разметка поста для публичной страницы (tgme_widget_message_text у t.me):
// текст + сущности → HTML. Offset/length сущностей — в кодовых единицах
// UTF-16 (как у клиента), поэтому позиция считается по UTF-16 длине рун.
//
// Пересекающиеся сущности закрываются и переоткрываются на границе, так что
// вложенность тегов всегда правильная. Весь текст экранируется; href
// text_link — только http(s), иначе сущность рисуется простым текстом.

type richSpan struct {
	start, end int
	open       string
	close      string
}

func entityTags(e domain.MessageEntity) (open, close string, ok bool) {
	switch v := e.(type) {
	case domain.MessageEntityBold:
		return "<b>", "</b>", true
	case domain.MessageEntityItalic:
		return "<i>", "</i>", true
	case domain.MessageEntityUnderline:
		return "<u>", "</u>", true
	case domain.MessageEntityStrike:
		return "<s>", "</s>", true
	case domain.MessageEntityCode:
		return "<code>", "</code>", true
	case domain.MessageEntityPre:
		return "<pre>", "</pre>", true
	case domain.MessageEntitySpoiler:
		return `<span class="tg-spoiler">`, "</span>", true
	case domain.MessageEntityBlockquote:
		return "<blockquote>", "</blockquote>", true
	case domain.MessageEntityTextURL:
		u, err := url.Parse(v.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return "", "", false
		}
		return `<a href="` + html.EscapeString(u.String()) + `" target="_blank" rel="noopener">`, "</a>", true
	}
	return "", "", false
}

func renderRichText(text string, entities domain.MessageEntities) template.HTML {
	runes := []rune(text)
	total := len(utf16.Encode(runes))

	spans := make([]richSpan, 0, len(entities))
	for _, e := range entities {
		off, length := e.Span()
		if off < 0 || length <= 0 || off >= total {
			continue
		}
		open, cls, ok := entityTags(e)
		if !ok {
			continue
		}
		spans = append(spans, richSpan{start: off, end: min(off+length, total), open: open, close: cls})
	}
	// Раньше начавшаяся и более длинная — снаружи.
	sort.SliceStable(spans, func(a, b int) bool {
		if spans[a].start != spans[b].start {
			return spans[a].start < spans[b].start
		}
		return spans[a].end > spans[b].end
	})

	var b strings.Builder
	var stack []richSpan
	next := 0 // первый ещё не открытый span
	sync := func(pos int) {
		// Закрыть всё, что кончилось; попутно снятые, но ещё живые — переоткрыть.
		if len(stack) > 0 {
			first := -1
			for i, s := range stack {
				if s.end <= pos {
					first = i
					break
				}
			}
			if first >= 0 {
				var reopen []richSpan
				for i := len(stack) - 1; i >= first; i-- {
					b.WriteString(stack[i].close)
					if stack[i].end > pos {
						reopen = append(reopen, stack[i])
					}
				}
				stack = stack[:first]
				for i := len(reopen) - 1; i >= 0; i-- {
					b.WriteString(reopen[i].open)
					stack = append(stack, reopen[i])
				}
			}
		}
		for next < len(spans) && spans[next].start <= pos {
			if spans[next].end > pos {
				b.WriteString(spans[next].open)
				stack = append(stack, spans[next])
			}
			next++
		}
	}

	pos := 0
	for _, r := range runes {
		sync(pos)
		switch r {
		case '\n':
			b.WriteString("<br>")
		default:
			b.WriteString(html.EscapeString(string(r)))
		}
		pos += utf16.RuneLen(r)
	}
	for i := len(stack) - 1; i >= 0; i-- {
		b.WriteString(stack[i].close)
	}
	return template.HTML(b.String()) //nolint:gosec // текст экранирован, теги — из фиксированного набора
}

// plainPreview — текст поста для og:description: одна строка, до n рун.
func plainPreview(text string, n int) string {
	s := strings.Join(strings.Fields(text), " ")
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}
