package domain

import (
	"encoding/json"
	"sort"
	"testing"
)

// Механическая сверка модели РАЗМЕТКИ КЛАВИАТУР со схемой TL — тот же сверщик
// (schemaChecker), что у медиа и сущностей, те же два утверждения:
//
//  1. Лишнего нет: каждый ключ сериализованного объекта — параметр конструктора
//     из схемы либо клиентский параметр из schema_additional_params.json.
//
//  2. Пропущенное названо: обязательные параметры схемы, которых нет в выводе,
//     сверяются с явным списком «нет предмета».
//
// Разметка вложенная (markup → rows → buttons), поэтому сверщик обходит её
// целиком: конструктор ряда и каждой кнопки проверяются наравне с верхним.
//
// Тест не проверяет типы значений и порядок полей — это работа кодека (фаза 2).

// replyMarkupOmittedWithoutSubject — обязательных параметров, которых мы не
// производим, у разметки нет: rows/buttons/text/url/data выводятся все. Пустая
// карта здесь — утверждение, а не забывчивость: появится непроизводимый
// обязательный параметр — его придётся назвать здесь явно.
//
// Не путать с параметром `style:flags.10?KeyboardButtonStyle` (оформление
// кнопок premium-ботов): у него предмета нет, но он и НЕ обязателен — его
// отсутствие сверщик не считает пропуском по построению.
var replyMarkupOmittedWithoutSubject = map[string][]string{}

func checkReplyMarkupAgainstSchema(t *testing.T, markups []ReplyMarkup) (unexpected, omitted []string) {
	t.Helper()

	raw, err := json.Marshal(markups)
	if err != nil {
		t.Fatalf("разметка не сериализуется: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разметка не разбирается обратно: %v", err)
	}

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		omittedOK:    replyMarkupOmittedWithoutSubject,
	}
	c.walk(decoded, "markup")
	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

// allReplyMarkupConstructors — по одному экземпляру КАЖДОГО конструктора обоих
// наших объединений (ReplyMarkup и KeyboardButton). Новый конструктор без
// строки здесь просто не будет сверен со схемой, поэтому список продублирован
// проверкой полноты ниже.
func allReplyMarkupConstructors() []ReplyMarkup {
	return []ReplyMarkup{
		NewReplyInlineMarkup([]KeyboardButtonRow{
			NewKeyboardButtonRow(
				NewKeyboardButtonCallback("алерт", []byte("alert")),
				NewKeyboardButtonURL("сайт", "https://telegram.org")),
			NewKeyboardButtonRow(NewKeyboardButtonWebView("mini-app", "/webapp-demo.html")),
			// Обязательный data едет и пустым: у bytes «пусто» это не «нет».
			NewKeyboardButtonRow(NewKeyboardButtonCallback("без данных", nil)),
		}),
		NewReplyKeyboardMarkup([]KeyboardButtonRow{
			NewKeyboardButtonRow(NewKeyboardButton("A"), NewKeyboardButton("B")),
		}, ReplyKeyboardFlags{Resize: true, SingleUse: true, Selective: true, Persistent: true}, "напишите что-нибудь"),
		// Та же клавиатура без единого флага и без подсказки: pFlags и
		// placeholder обязаны исчезнуть, а rows — остаться.
		NewReplyKeyboardMarkup(nil, ReplyKeyboardFlags{}, ""),
		NewReplyKeyboardHide(true),
		NewReplyKeyboardHide(false),
		NewReplyKeyboardForceReply(true, true, "ответьте"),
		NewReplyKeyboardForceReply(false, false, ""),
	}
}

func TestReplyMarkup_MatchesSchema(t *testing.T) {
	unexpected, omitted := checkReplyMarkupAgainstSchema(t, allReplyMarkupConstructors())
	for _, v := range unexpected {
		t.Errorf("лишнее поле: %s", v)
	}
	for _, v := range omitted {
		t.Errorf("молчаливый пропуск: %s", v)
	}
}

// Полнота: каждое объявленное значение дискриминатора реально встречается среди
// сверенных объектов. Иначе конструктор можно было бы завести и забыть про него.
func TestReplyMarkup_EveryConstructorIsChecked(t *testing.T) {
	seen := map[string]bool{}
	var mark func(v any)
	mark = func(v any) {
		switch x := v.(type) {
		case []any:
			for _, item := range x {
				mark(item)
			}
		case map[string]any:
			if u, ok := x["_"].(string); ok {
				seen[u] = true
			}
			for _, item := range x {
				mark(item)
			}
		}
	}
	raw, _ := json.Marshal(allReplyMarkupConstructors())
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	mark(decoded)

	ctors := loadSchemaConstructors(t)
	for _, tag := range []string{
		ReplyInlineMarkupTag, ReplyKeyboardMarkupTag, ReplyKeyboardHideTag,
		ReplyKeyboardForceReplyTag, KeyboardButtonRowTag, KeyboardButtonTag,
		KeyboardButtonCallbackTag, KeyboardButtonURLTag, KeyboardButtonWebViewTag,
	} {
		if !seen[tag] {
			t.Errorf("конструктор %q не участвует в сверке со схемой", tag)
		}
		if _, ok := ctors[tag]; !ok {
			t.Errorf("конструктора %q нет в схеме", tag)
		}
	}
}

// pFlags несёт только true: «выключено» — это отсутствие ключа. Проверяется на
// всех уровнях вложенности, потому что pFlags есть и у кнопки.
func TestReplyMarkup_PFlagsNeverFalse(t *testing.T) {
	raw, _ := json.Marshal(allReplyMarkupConstructors())
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	var check func(v any)
	check = func(v any) {
		switch x := v.(type) {
		case []any:
			for _, item := range x {
				check(item)
			}
		case map[string]any:
			if pf, ok := x["pFlags"]; ok {
				flags, _ := pf.(map[string]any)
				if len(flags) == 0 {
					t.Errorf("%v: пустой pFlags сериализован — должен отсутствовать", x["_"])
				}
				for k, val := range flags {
					if val != true {
						t.Errorf("%v: pFlags[%q] = %v, а «выключено» — это отсутствие ключа", x["_"], k, val)
					}
				}
			}
			for k, item := range x {
				if k != "pFlags" {
					check(item)
				}
			}
		}
	}
	check(decoded)
}

// data:bytes на JSON-проводе — base64-строка, ровно как photoStrippedSize.bytes
// у медиа. Тест держит именно форму провода: она станет настоящими байтами на
// фазе 2, и переделка не должна пройти незамеченной.
func TestReplyMarkup_CallbackDataIsBase64(t *testing.T) {
	raw, err := json.Marshal(NewKeyboardButtonCallback("нажми", []byte("alert")))
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	const want = `{"_":"keyboardButtonCallback","text":"нажми","data":"YWxlcnQ="}`
	if string(raw) != want {
		t.Errorf("кнопка сериализована как %s, ждали %s", raw, want)
	}
	// Обязательный параметр едет и пустым — «пусто» это не «нет ключа».
	raw, _ = json.Marshal(NewKeyboardButtonCallback("пусто", nil))
	if string(raw) != `{"_":"keyboardButtonCallback","text":"пусто","data":""}` {
		t.Errorf("пустой data сериализован как %s", raw)
	}
}

// Разбор: дискриминатор ведёт в свой конструктор, чужой/отсутствующий —
// объединение отдаёт nil, кнопка отбрасывается, а не роняет весь ряд.
func TestReplyMarkup_Unmarshal(t *testing.T) {
	t.Run("inline с объединением кнопок", func(t *testing.T) {
		in := []byte(`{"_":"replyInlineMarkup","rows":[{"_":"keyboardButtonRow","buttons":[
			{"_":"keyboardButtonCallback","text":"a","data":"YWxlcnQ="},
			{"_":"keyboardButtonUrl","text":"b","url":"https://example.com"},
			{"_":"keyboardButtonWebView","text":"c","url":"/app"},
			{"_":"keyboardButtonBuy","text":"d"},
			{"text":"старая плоская","callback":"x"}
		]}]}`)
		m, err := UnmarshalReplyMarkup(in)
		if err != nil {
			t.Fatalf("разбор: %v", err)
		}
		inline, ok := m.(ReplyInlineMarkup)
		if !ok || len(inline.Rows) != 1 {
			t.Fatalf("разобрано %#v", m)
		}
		btns := inline.Rows[0].Buttons
		if len(btns) != 3 {
			t.Fatalf("кнопок %d, ждали 3 (чужой конструктор и старая плоская запись отбрасываются): %#v", len(btns), btns)
		}
		cb, ok := btns[0].(KeyboardButtonCallback)
		if !ok || string(cb.Data) != "alert" {
			t.Errorf("btns[0] = %#v, ждали callback с данными alert", btns[0])
		}
		if _, ok := btns[1].(KeyboardButtonURL); !ok {
			t.Errorf("btns[1] = %#v, ждали keyboardButtonUrl", btns[1])
		}
		if _, ok := btns[2].(KeyboardButtonWebView); !ok {
			t.Errorf("btns[2] = %#v, ждали keyboardButtonWebView", btns[2])
		}
	})

	t.Run("флаги клавиатуры", func(t *testing.T) {
		in := []byte(`{"_":"replyKeyboardMarkup","pFlags":{"resize":true,"single_use":false,"выдуманный":true},
			"rows":[{"_":"keyboardButtonRow","buttons":[{"_":"keyboardButton","text":"A"}]}],
			"placeholder":"подсказка"}`)
		m, err := UnmarshalReplyMarkup(in)
		if err != nil {
			t.Fatalf("разбор: %v", err)
		}
		kb, ok := m.(ReplyKeyboardMarkup)
		if !ok {
			t.Fatalf("разобрано %#v", m)
		}
		if !kb.Resize() {
			t.Error("resize потерян")
		}
		// single_use:false — это ОТСУТСТВИЕ флага, а не флаг со значением false;
		// выдуманный ключ в модель попасть не должен вовсе.
		if len(kb.PFlags) != 1 {
			t.Errorf("pFlags = %#v, ждали ровно {resize:true}", kb.PFlags)
		}
		if kb.Placeholder == nil || *kb.Placeholder != "подсказка" {
			t.Errorf("placeholder = %v", kb.Placeholder)
		}
	})

	t.Run("скрытие и force reply", func(t *testing.T) {
		m, _ := UnmarshalReplyMarkup([]byte(`{"_":"replyKeyboardHide","pFlags":{"selective":true}}`))
		if hide, ok := m.(ReplyKeyboardHide); !ok || !hide.Selective() {
			t.Errorf("разобрано %#v, ждали replyKeyboardHide с selective", m)
		}
		m, _ = UnmarshalReplyMarkup([]byte(`{"_":"replyKeyboardForceReply","placeholder":"ответьте"}`))
		fr, ok := m.(ReplyKeyboardForceReply)
		if !ok || fr.Placeholder == nil || *fr.Placeholder != "ответьте" || fr.PFlags != nil {
			t.Errorf("разобрано %#v, ждали replyKeyboardForceReply без флагов", m)
		}
	})

	t.Run("чужой и старый конструктор", func(t *testing.T) {
		// Старая плоская форма {"inline":[…]} дискриминатора не несёт: сообщение
		// приезжает без клавиатуры, а не роняет чтение всей истории.
		for _, in := range []string{
			`{"inline":[[{"text":"a","callback":"b"}]]}`,
			`{"_":"replyKeyboardMarkupUnknown"}`,
			`null`,
		} {
			m, err := UnmarshalReplyMarkup([]byte(in))
			if err != nil || m != nil {
				t.Errorf("%s → %#v, %v; ждали nil, nil", in, m, err)
			}
		}
	})

	t.Run("обязательные векторы не null", func(t *testing.T) {
		// rows/buttons обязательны по схеме: после круга разбор → сборка они
		// обязаны остаться [], а не превратиться в null.
		m, err := UnmarshalReplyMarkup([]byte(`{"_":"replyInlineMarkup"}`))
		if err != nil {
			t.Fatalf("разбор: %v", err)
		}
		raw, _ := json.Marshal(m)
		if string(raw) != `{"_":"replyInlineMarkup","rows":[]}` {
			t.Errorf("собрано %s", raw)
		}
		var row KeyboardButtonRow
		if err := json.Unmarshal([]byte(`{"_":"keyboardButtonRow","buttons":[]}`), &row); err != nil {
			t.Fatalf("разбор ряда: %v", err)
		}
		raw, _ = json.Marshal(row)
		if string(raw) != `{"_":"keyboardButtonRow","buttons":[]}` {
			t.Errorf("ряд собран как %s", raw)
		}
	})
}
