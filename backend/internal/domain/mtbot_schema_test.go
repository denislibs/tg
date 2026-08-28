package domain

import (
	"sort"
	"testing"
)

// Механическая сверка витрин ботов со схемой TL.

func TestBot_MatchesSchema(t *testing.T) {
	inline := NewBotInlineResult(InlineResult{
		ID: "r1", Title: "Погода", Description: "в Москве", Emoji: "☀️", MessageText: "+21",
	})
	cases := []struct {
		name  string
		value any
	}{
		{"команда", NewBotCommand(BotCommand{Command: "start", Description: "начать"})},
		{"кнопка-меню", NewBotMenuButton("Открыть", "https://example/app")},
		{"строка выдачи", inline},
		{"контейнер выдачи", NewMessagesBotResults(
			[]BotInlineResult{inline},
			[]UserReal{{Underscore: UserTag, ID: 7, BotInlinePlaceholder: "Поиск…"}})},
		{"пустая выдача", NewMessagesBotResults(nil, nil)},
		{"ответ плашкой", NewBotCallbackAnswer("Готово", true)},
		{"ответ тостом", NewBotCallbackAnswer("Готово", false)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "bot")
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

// «Показать плашкой» — ФЛАГ: его ОТСУТСТВИЕ и есть «тостом». Прежде ехало
// булево поле `alert: false`, то есть «выключено» имело значение.
func TestBot_CallbackAlertIsAFlag(t *testing.T) {
	toast, ok := roundTripJSON(t, NewBotCallbackAnswer("Готово", false)).(map[string]any)
	if !ok {
		t.Fatal("ответ не разобрался в объект")
	}
	if _, has := toast["pFlags"]; has {
		t.Errorf("тост несёт pFlags: %v", toast["pFlags"])
	}
	if _, has := toast["alert"]; has {
		t.Error("булево поле alert осталось рядом с конструктором")
	}
	alert, _ := roundTripJSON(t, NewBotCallbackAnswer("Готово", true)).(map[string]any)
	flags, _ := alert["pFlags"].(map[string]any)
	if flags["alert"] != true {
		t.Errorf("плашка без флага: %v", alert)
	}
}
