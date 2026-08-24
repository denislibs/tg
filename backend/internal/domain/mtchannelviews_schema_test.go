package domain

import (
	"sort"
	"testing"
)

// Механическая сверка счётчиков поста и списков чатов со схемой TL.

func viewsOmittedOK() map[string][]string {
	out := map[string][]string{}
	for _, src := range []map[string][]string{OmittedWithoutSubject, messageOmittedWithoutSubject, peerOmittedWithoutSubject} {
		for k, v := range src {
			out[k] = append(append([]string{}, out[k]...), v...)
		}
	}
	return out
}

func TestChannelViews_MatchesSchema(t *testing.T) {
	replies := NewMessageReplies(3, 0, []Peer{NewPeerUser(7)})
	cases := []struct {
		name  string
		value any
	}{
		{"просмотры", NewMessageViewsCount(9200)},
		{"тред", NewMessageViewsReplies(replies)},
		{"пробел вектора", NewMessageViewsEmpty()},
		{"контейнер счётчиков", NewMessagesMessageViews(
			[]MessageViews{NewMessageViewsCount(1), NewMessageViewsEmpty()},
			[]UserReal{{Underscore: UserTag, ID: 7}})},
		{"список чатов", NewMessagesChats([]Chat{ChatReal{Underscore: ChatTag, ID: 5, Title: "Клуб"}})},
		{"кусок списка", NewMessagesChatsSlice(42, []Chat{ChatReal{Underscore: ChatTag, ID: 5, Title: "Клуб"}})},
		{"пустой список", NewMessagesChats(nil)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				// Два пропуска уже названы соседними подсистемами: журнал
				// апдейтов треда (у нас pts на чат) и `version` чата.
				omittedOK: viewsOmittedOK(),
			}
			c.walk(roundTripJSON(t, tc.value), "views")
			sort.Strings(c.unexpected)
			sort.Strings(c.omitted)
			for _, s := range c.unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range c.omitted {
				t.Errorf("пропущено: %s", s)
			}
		})
	}
}

// «Про этот пост сказать нечего» — конструктор БЕЗ параметров, а не ноль:
// у поста без комментариев треда не существует вовсе, и `replies: 0` соврал бы
// о его наличии. Пробел позиционного вектора выражается именно так.
func TestChannelViews_EmptyIsAbsenceNotZero(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewMessageViewsEmpty()).(map[string]any)
	if !ok {
		t.Fatal("счётчик не разобрался в объект")
	}
	if len(decoded) != 1 || decoded["_"] != MessageViewsTag {
		t.Errorf("пустой счётчик = %v; ожидался один дискриминатор", decoded)
	}
}
