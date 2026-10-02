package domain

import (
	"slices"
	"strings"
	"testing"
)

func TestMentionedUsernames(t *testing.T) {
	cases := []struct {
		name     string
		text     string
		entities MessageEntities
		want     []string
	}{
		{"в начале", "@bob_petrov видно в сайдбаре?", nil, []string{"bob_petrov"}},
		{"после пробела и в конце", "привет @bob_petrov", nil, []string{"bob_petrov"}},
		{"регистр сводится", "@Bob_Petrov", nil, []string{"bob_petrov"}},
		{"пунктуация вокруг", "(@bob_petrov), @alice_x.", nil, []string{"bob_petrov", "alice_x"}},
		{"после перевода строки", "эй\n@bob_petrov", nil, []string{"bob_petrov"}},
		{"несколько и повтор", "@alice_x @bob_petrov @ALICE_X", nil, []string{"alice_x", "bob_petrov"}},
		{"e-mail — не упоминание", "пиши на bob@bob_petrov.com", nil, nil},
		{"внутри слова — не упоминание", "abc@bob_petrov", nil, nil},
		{"буква сразу после имени", "@bob_petrovтест", nil, nil},
		{"кириллица перед @", "тест@bob_petrov", nil, nil},
		{"короче 5", "@abcd", nil, nil},
		{"ровно 5", "@abcde", nil, []string{"abcde"}},
		{"ровно 32", "@" + strings.Repeat("a", 32), nil, []string{strings.Repeat("a", 32)}},
		{"33 не обрезается до 32", "@" + strings.Repeat("a", 33), nil, nil},
		{"двойная @", "@@bob_petrov", nil, []string{"bob_petrov"}},
		{"неудача не съедает следующее", "@ab @bob_petrov", nil, []string{"bob_petrov"}},
		{"нет @", "просто текст", nil, nil},
		// Смещения code/pre — в UTF-16: «😀» = 2 единицы, «я » = 2.
		{"внутри code — нет", "😀 `@bob_petrov` @alice_x", MessageEntities{NewMessageEntityCode(3, 12)}, []string{"alice_x"}},
		{"внутри pre — нет", "я @bob_petrov", MessageEntities{NewMessageEntityPre(2, 11, "")}, nil},
		{"code рядом не мешает", "я @bob_petrov x", MessageEntities{NewMessageEntityCode(14, 1)}, []string{"bob_petrov"}},
		{"bold не мешает", "@bob_petrov", MessageEntities{NewMessageEntityBold(0, 11)}, []string{"bob_petrov"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := MentionedUsernames(c.text, c.entities)
			if !slices.Equal(got, c.want) {
				t.Fatalf("MentionedUsernames(%q) = %v, want %v", c.text, got, c.want)
			}
		})
	}
}
