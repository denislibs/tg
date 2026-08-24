package domain

import (
	"sort"
	"testing"
	"time"
)

// Механическая сверка стадий секретного чата со схемой TL.

func TestSecretChat_MatchesSchema(t *testing.T) {
	base := SecretChat{
		ChatID: 5, InitiatorID: 7, ResponderID: 9,
		InitiatorPub: []byte{1, 2, 3}, ResponderPub: []byte{4, 5, 6},
		CreatedAt: time.Unix(1787334148, 0),
	}
	cases := []struct {
		name  string
		state string
	}{
		{"запрошен", SecretRequested},
		{"установлен", SecretAccepted},
		{"отклонён", SecretRejected},
		{"разорван", SecretDiscarded},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sc := base
			sc.State = tc.state
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, NewEncryptedChat(sc)), "secret")
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

// Стадия handshake — ВЫБОР КОНСТРУКТОРА, а не строка рядом с ключом. Вместе со
// стадией меняется и набор полей: у запрошенного ключ инициатора, у
// установленного — ключ второй стороны, у отменённого нет ни того ни другого.
func TestSecretChat_StageIsTheConstructor(t *testing.T) {
	base := SecretChat{ChatID: 5, InitiatorID: 7, ResponderID: 9,
		InitiatorPub: []byte{1}, ResponderPub: []byte{2}, CreatedAt: time.Unix(1, 0)}
	want := map[string]struct {
		tag string
		key string
	}{
		SecretRequested: {EncryptedChatRequestedTag, "g_a"},
		SecretAccepted:  {EncryptedChatTag, "g_a_or_b"},
		SecretRejected:  {EncryptedChatDiscardedTag, ""},
		SecretDiscarded: {EncryptedChatDiscardedTag, ""},
	}
	for state, exp := range want {
		sc := base
		sc.State = state
		decoded, ok := roundTripJSON(t, NewEncryptedChat(sc)).(map[string]any)
		if !ok {
			t.Fatalf("%s: не разобралось в объект", state)
		}
		if decoded["_"] != exp.tag {
			t.Errorf("%s: _ = %v, ожидался %q", state, decoded["_"], exp.tag)
		}
		if _, has := decoded["state"]; has {
			t.Errorf("%s: строка стадии осталась рядом с конструктором", state)
		}
		if exp.key != "" {
			if _, has := decoded[exp.key]; !has {
				t.Errorf("%s: ключ %q не выведен", state, exp.key)
			}
		}
	}
}
