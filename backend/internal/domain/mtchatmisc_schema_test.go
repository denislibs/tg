package domain

import (
	"sort"
	"testing"
	"time"
)

// Механическая сверка мелких витрин чата и списков реакций со схемой TL.
//
// Все они ехали безымянными обёртками вокруг значения — сверщик до них не
// доходил, потому что ходит по типам Go.

func chatMiscCases() []struct {
	name  string
	value any
} {
	return []struct {
		name  string
		value any
	}{
		{"период автоудаления", NewDefaultHistoryTTL(86400)},
		{"когда прочитали моё", NewOutboxReadDate(time.Unix(1787334148, 0))},
		{"расшифровка готова", NewMessagesTranscribedAudio("раз два", false)},
		{"расшифровка идёт", NewMessagesTranscribedAudio("", true)},
		{"перевод", NewMessagesTranslateResult("привет")},
		{"кто отреагировал", NewMessagesMessageReactionsList(
			[]MessagePeerReaction{NewMessagePeerReaction(NewPeerUser(9), time.Unix(1, 0), NewReactionEmoji("👍"))},
			[]UserReal{{Underscore: UserTag, ID: 9, FirstName: "Аня"}})},
		{"теги Избранного", NewMessagesSavedReactionTags([]SavedTag{{Reaction: "👍", Title: "важное", Count: 3}})},
		{"теги без имени", NewMessagesSavedReactionTags([]SavedTag{{Reaction: "🔥", Count: 1}})},
		{"от чьего лица", NewChannelsSendAsPeers(
			[]SendAsPeer{NewSendAsPeer(NewPeerUser(1)), NewSendAsPeer(NewPeerChannel(5))}, nil, nil)},
	}
}

func TestChatMisc_MatchesSchema(t *testing.T) {
	for _, tc := range chatMiscCases() {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "chatmisc")
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

// «Ещё расшифровывается» — ФЛАГ: его ОТСУТСТВИЕ и есть «готово». Прежде ехало
// булево поле `pending: false`, то есть «выключено» имело значение.
func TestChatMisc_PendingIsAFlagNotAField(t *testing.T) {
	done, ok := roundTripJSON(t, NewMessagesTranscribedAudio("раз", false)).(map[string]any)
	if !ok {
		t.Fatal("расшифровка не разобралась в объект")
	}
	if _, has := done["pFlags"]; has {
		t.Errorf("готовая расшифровка несёт pFlags: %v", done["pFlags"])
	}
	if _, has := done["pending"]; has {
		t.Error("булево поле pending осталось рядом с конструктором")
	}
}

// Перевод — ВЕКТОР строк с разметкой; языка-источника у конструктора нет вовсе.
func TestChatMisc_TranslateIsAVectorWithoutSourceLanguage(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewMessagesTranslateResult("привет")).(map[string]any)
	if !ok {
		t.Fatal("перевод не разобрался в объект")
	}
	result, ok := decoded["result"].([]any)
	if !ok || len(result) != 1 {
		t.Fatalf("result = %v", decoded["result"])
	}
	if _, has := decoded["source"]; has {
		t.Error("язык-источник уехал рядом с конструктором")
	}
}
