package http

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Bot API — фасад: снаружи плоская запись чужой документации
// (inline_keyboard / keyboard / resize_keyboard / one_time_keyboard /
// callback_data / web_app), внутри — объединение конструкторов схемы TL.
// Зеркало botapi_entities_test.go: конвертер держится тестом с ОБЕИХ сторон,
// иначе сторонний бот молча потеряет клавиатуру.

func TestParseReplyMarkup_InlineToModel(t *testing.T) {
	raw := json.RawMessage(`{"inline_keyboard":[
		[{"text":"алерт","callback_data":"alert"},{"text":"сайт","url":"https://telegram.org"}],
		[{"text":"mini-app","web_app":{"url":"/webapp-demo.html"}}]
	]}`)

	want := domain.NewReplyInlineMarkup([]domain.KeyboardButtonRow{
		domain.NewKeyboardButtonRow(
			domain.NewKeyboardButtonCallback("алерт", []byte("alert")),
			domain.NewKeyboardButtonURL("сайт", "https://telegram.org")),
		domain.NewKeyboardButtonRow(domain.NewKeyboardButtonWebView("mini-app", "/webapp-demo.html")),
	})

	got := parseReplyMarkup(raw)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseReplyMarkup =\n%#v\nwant\n%#v", got, want)
	}
}

func TestParseReplyMarkup_KeyboardToModel(t *testing.T) {
	// Ячейка reply-клавиатуры бывает объектом и (легаси) голой строкой —
	// контракт Bot API принимает обе формы.
	raw := json.RawMessage(`{"keyboard":[[{"text":"A"},"B"],[{"text":"/hide"}]],
		"resize_keyboard":true,"one_time_keyboard":true,"is_persistent":true,
		"selective":true,"input_field_placeholder":"напишите"}`)

	want := domain.NewReplyKeyboardMarkup([]domain.KeyboardButtonRow{
		domain.NewKeyboardButtonRow(domain.NewKeyboardButton("A"), domain.NewKeyboardButton("B")),
		domain.NewKeyboardButtonRow(domain.NewKeyboardButton("/hide")),
	}, domain.ReplyKeyboardFlags{Resize: true, SingleUse: true, Selective: true, Persistent: true}, "напишите")

	got := parseReplyMarkup(raw)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseReplyMarkup =\n%#v\nwant\n%#v", got, want)
	}
}

// remove_keyboard и force_reply — самостоятельные конструкторы объединения, а
// не состояния поля keyboard: прежняя форма их различить не умела вовсе.
func TestParseReplyMarkup_HideAndForceReply(t *testing.T) {
	got := parseReplyMarkup(json.RawMessage(`{"remove_keyboard":true,"selective":true}`))
	if !reflect.DeepEqual(got, domain.NewReplyKeyboardHide(true)) {
		t.Errorf("remove_keyboard → %#v", got)
	}
	got = parseReplyMarkup(json.RawMessage(`{"force_reply":true,"input_field_placeholder":"ответьте"}`))
	if !reflect.DeepEqual(got, domain.NewReplyKeyboardForceReply(false, false, "ответьте")) {
		t.Errorf("force_reply → %#v", got)
	}
	if got := parseReplyMarkup(nil); got != nil {
		t.Errorf("пустой reply_markup → %#v, ждали nil", got)
	}
}

func TestBotAPIReplyMarkup_ModelToBotAPI(t *testing.T) {
	cases := []struct {
		name   string
		markup domain.ReplyMarkup
		want   string
	}{
		{
			name: "inline",
			markup: domain.NewReplyInlineMarkup([]domain.KeyboardButtonRow{
				domain.NewKeyboardButtonRow(
					domain.NewKeyboardButtonCallback("алерт", []byte("alert")),
					domain.NewKeyboardButtonURL("сайт", "https://telegram.org"),
					domain.NewKeyboardButtonWebView("app", "/a.html")),
			}),
			want: `{"inline_keyboard":[[{"callback_data":"alert","text":"алерт"},` +
				`{"text":"сайт","url":"https://telegram.org"},` +
				`{"text":"app","web_app":{"url":"/a.html"}}]]}`,
		},
		{
			name: "клавиатура с флагами",
			markup: domain.NewReplyKeyboardMarkup([]domain.KeyboardButtonRow{
				domain.NewKeyboardButtonRow(domain.NewKeyboardButton("A")),
			}, domain.ReplyKeyboardFlags{Resize: true}, ""),
			want: `{"keyboard":[[{"text":"A"}]],"resize_keyboard":true}`,
		},
		{
			// «Выключено» и в Bot API значит отсутствие ключа — false не кладём,
			// чтобы ответ совпадал с телеграмным.
			name: "клавиатура без флагов",
			markup: domain.NewReplyKeyboardMarkup([]domain.KeyboardButtonRow{
				domain.NewKeyboardButtonRow(domain.NewKeyboardButton("A")),
			}, domain.ReplyKeyboardFlags{}, ""),
			want: `{"keyboard":[[{"text":"A"}]]}`,
		},
		{name: "скрыть", markup: domain.NewReplyKeyboardHide(false), want: `{"remove_keyboard":true}`},
		{
			name:   "force reply",
			markup: domain.NewReplyKeyboardForceReply(false, true, "ответьте"),
			want:   `{"force_reply":true,"input_field_placeholder":"ответьте","selective":true}`,
		},
		{name: "нет клавиатуры", markup: nil, want: `null`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := json.Marshal(botAPIReplyMarkup(tc.markup))
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if string(got) != tc.want {
				t.Fatalf("botAPIReplyMarkup =\n%s\nwant\n%s", got, tc.want)
			}
		})
	}
}

// Круг «Bot API → модель → Bot API» не теряет ничего, что Bot API умеет
// выразить: именно этим конвертер и обязан отличаться от «типы совпадают».
func TestBotAPIReplyMarkup_RoundTrip(t *testing.T) {
	for _, raw := range []string{
		`{"inline_keyboard":[[{"text":"a","callback_data":"alert"},{"text":"b","url":"https://x.example"}],` +
			`[{"text":"c","web_app":{"url":"/app"}}]]}`,
		`{"keyboard":[[{"text":"A"},{"text":"B"}]],"resize_keyboard":true,"one_time_keyboard":true,` +
			`"is_persistent":true,"selective":true,"input_field_placeholder":"напишите"}`,
		`{"remove_keyboard":true,"selective":true}`,
		`{"force_reply":true,"one_time_keyboard":true,"selective":true,"input_field_placeholder":"ответьте"}`,
	} {
		back, err := json.Marshal(botAPIReplyMarkup(parseReplyMarkup(json.RawMessage(raw))))
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var want, got any
		_ = json.Unmarshal([]byte(raw), &want)
		_ = json.Unmarshal(back, &got)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("круг Bot API → модель → Bot API разошёлся:\n%s\nvs\n%s", back, raw)
		}
	}
}
