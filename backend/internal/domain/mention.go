package domain

import (
	"strings"
	"unicode"
	"unicode/utf16"
)

// Границы имени в упоминании «@username» — как у пользовательских имён
// (ValidateUsername): 5–32 символа [A-Za-z0-9_].
const (
	mentionMinLen = 5
	mentionMaxLen = 32
)

// MentionedUsernames — имена из упоминаний «@username» в тексте сообщения,
// в нижнем регистре, без повторов, в порядке появления.
//
// Правило — серверное распознавание Telegram (tdlib MessageEntity.cpp,
// match_mentions: `(?<=\B)@([a-zA-Z0-9_]{…})(?=\b)`): перед «@» не стоит
// буква/цифра/«_» (иначе это e-mail или середина слова — `bob@bob_petrov.com`),
// имя — подряд идущие [A-Za-z0-9_], и сразу за ним не идёт буква/цифра
// (`@bob_petrovтест` — не упоминание). Слишком длинный хвост имя не обрезает:
// 33 символа подряд — не упоминание вовсе.
//
// Упоминание внутри code/pre упоминанием не считается: в Telegram такие
// сущности не содержат вложенных (tdlib fix_entities), и «@имя» в коде не
// становится ни ссылкой, ни адресатом. Смещения сущностей — в UTF-16.
func MentionedUsernames(text string, entities MessageEntities) []string {
	if !strings.Contains(text, "@") {
		return nil
	}
	var code [][2]int // UTF-16 полуинтервалы code/pre
	for _, e := range entities {
		switch e.(type) {
		case MessageEntityCode, MessageEntityPre:
			off, n := e.Span()
			code = append(code, [2]int{off, off + n})
		}
	}
	inCode := func(from, to int) bool {
		for _, c := range code {
			if from < c[1] && c[0] < to {
				return true
			}
		}
		return false
	}

	runes := []rune(text)
	var out []string
	var seen map[string]bool
	pos16 := 0 // UTF-16 смещение runes[i]
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		if r != '@' || (i > 0 && isWordRune(runes[i-1])) {
			pos16 += utf16Len(r)
			continue
		}
		j := i + 1
		for j < len(runes) && isUsernameRune(runes[j]) {
			j++
		}
		n := j - i - 1 // имя — только ASCII: руна = одна единица UTF-16
		ok := n >= mentionMinLen && n <= mentionMaxLen &&
			(j == len(runes) || !isWordRune(runes[j])) &&
			!inCode(pos16, pos16+1+n)
		if ok {
			name := strings.ToLower(string(runes[i+1 : j]))
			if !seen[name] {
				if seen == nil {
					seen = map[string]bool{}
				}
				seen[name] = true
				out = append(out, name)
			}
		}
		pos16 += 1 + n
		i = j - 1
	}
	return out
}

func isUsernameRune(r rune) bool {
	return r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

// isWordRune — tdlib is_word_character: буква, цифра (любой письменности) или «_».
func isWordRune(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsNumber(r)
}

func utf16Len(r rune) int {
	if n := utf16.RuneLen(r); n > 0 {
		return n
	}
	return 1
}
