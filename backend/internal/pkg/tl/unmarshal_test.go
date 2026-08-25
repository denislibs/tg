package tl

import (
	"encoding/json"
	"strings"
	"testing"
)

// Круг «собрали — разобрали» на эталонных векторах. Именно здесь TL выигрывает
// у JSON как формат проверки: расхождение видно сразу и целиком, а не всплывает
// потом кривой геометрией у узкого видео.
func TestUnmarshal_RoundTrip(t *testing.T) {
	cases := []struct {
		name  string
		value map[string]any
	}{
		{"photoStrippedSize", map[string]any{"_": "photoStrippedSize", "type": "i", "bytes": []byte{1, 2, 3}}},
		{"messageEntityTextUrl", map[string]any{"_": "messageEntityTextUrl", "offset": 0, "length": 4,
			"url": "https://example.org"}},
		{"blockquoteCollapsed", map[string]any{"_": "messageEntityBlockquote", "offset": 2, "length": 30,
			"pFlags": map[string]bool{"collapsed": true}}},
		{"blockquotePlain", map[string]any{"_": "messageEntityBlockquote", "offset": 2, "length": 30}},
		{"replyInlineMarkup", map[string]any{"_": "replyInlineMarkup", "rows": []any{
			map[string]any{"_": "keyboardButtonRow", "buttons": []any{
				map[string]any{"_": "keyboardButton", "text": "ok"},
				map[string]any{"_": "keyboardButtonUrl", "text": "go", "url": "https://a.io"},
			}},
		}}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			body, err := Marshal(c.value)
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}
			back, err := bare.UnmarshalTree(body)
			if err != nil {
				t.Fatalf("Unmarshal: %v", err)
			}
			if got, want := asJSON(t, back), asJSON(t, c.value); got != want {
				t.Fatalf("круг не сошёлся\n получили %s\n ожидали  %s", got, want)
			}
		})
	}
}

// Заглушка занимает место в потоке, но в модель не возвращается: иначе круг
// показывал бы поля, которых модель не производит вовсе.
func TestUnmarshal_StubsDoNotComeBack(t *testing.T) {
	codec := NewCodec(map[string][]string{
		"document": {"access_hash", "file_reference", "date", "dc_id"},
	})

	doc := map[string]any{"_": "document", "id": 77, "mime_type": "image/webp", "size": 12,
		"attributes": []any{}}
	body, err := codec.Marshal(doc)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	back, err := codec.UnmarshalTree(body)
	if err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	for _, name := range []string{"access_hash", "file_reference", "date", "dc_id"} {
		if _, present := back[name]; present {
			t.Fatalf("заглушка %s вернулась в модель: %#v", name, back)
		}
	}
	if got, want := asJSON(t, back), asJSON(t, doc); got != want {
		t.Fatalf("круг не сошёлся\n получили %s\n ожидали  %s", got, want)
	}
}

// Хвост после разобранного значения — это не «лишние данные», а признак того,
// что раскладка разъехалась: читающая сторона идёт по позициям и остановилась
// не там. Молчать о нём нельзя.
func TestUnmarshal_TrailingBytesAreError(t *testing.T) {
	body, err := Marshal(map[string]any{"_": "messageEntityBold", "offset": 1, "length": 2})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	_, err = bare.UnmarshalTree(append(body, 0, 0, 0, 0))
	assertError(t, err, "осталось 4 байт")
}

func TestUnmarshal_UnknownConstructorIsError(t *testing.T) {
	_, err := bare.UnmarshalTree([]byte{1, 2, 3, 4})
	assertError(t, err, "нет в схеме")
}

// Оборванный буфер обязан быть ошибкой, а не значением по умолчанию.
func TestUnmarshal_ShortBufferIsError(t *testing.T) {
	body, _ := Marshal(map[string]any{"_": "messageEntityBold", "offset": 1, "length": 2})
	_, err := bare.UnmarshalTree(body[:len(body)-2])
	assertError(t, err, "буфер кончился")
}

// Разбор в значение, а не в дерево: дискриминатор и поля должны доехать до
// структуры целиком.
func TestUnmarshal_IntoValue(t *testing.T) {
	body, _ := Marshal(map[string]any{"_": "messageEntityTextUrl", "offset": 3, "length": 4,
		"url": "https://example.org"})

	var got struct {
		Underscore string `json:"_"`
		Offset     int    `json:"offset"`
		Length     int    `json:"length"`
		URL        string `json:"url"`
	}
	if err := bare.Unmarshal(body, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Underscore != "messageEntityTextUrl" || got.Offset != 3 || got.Length != 4 ||
		got.URL != "https://example.org" {
		t.Fatalf("разобрано как %#v", got)
	}
}

// Круг для вектора верхнего уровня: собрали срез — разобрали в срез. Форма
// `contacts.getStatuses = Vector<ContactStatus>` у оригинала, и вложенное
// объединение (`UserStatus`) внутри элемента разбирается тем же ходом.
func TestUnmarshal_TopLevelVectorRoundTrip(t *testing.T) {
	value := []any{
		map[string]any{"_": "contactStatus", "user_id": 7,
			"status": map[string]any{"_": "userStatusOnline", "expires": 1750000000}},
		map[string]any{"_": "contactStatus", "user_id": 9,
			"status": map[string]any{"_": "userStatusRecently", "pFlags": map[string]bool{}}},
	}

	body, err := Marshal(value)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got []struct {
		Underscore string `json:"_"`
		UserID     int64  `json:"user_id"`
		Status     struct {
			Underscore string `json:"_"`
			Expires    int    `json:"expires"`
		} `json:"status"`
	}
	if err := bare.Unmarshal(body, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("разобрано %d элементов, ожидали 2", len(got))
	}
	if got[0].UserID != 7 || got[0].Status.Underscore != "userStatusOnline" ||
		got[0].Status.Expires != 1750000000 {
		t.Fatalf("первый элемент = %#v", got[0])
	}
	if got[1].UserID != 9 || got[1].Status.Underscore != "userStatusRecently" {
		t.Fatalf("второй элемент = %#v", got[1])
	}
}

// Вектор верхнего уровня опознаётся ПО ПОТОКУ, а не по ожиданию вызывающего:
// `UnmarshalTree` просят конструктор, а приехал вектор — это ошибка, а не
// молча взятый первый элемент.
func TestUnmarshal_TopLevelVectorIsNotAConstructor(t *testing.T) {
	body, _ := Marshal([]any{map[string]any{"_": "messageEntityBold", "offset": 0, "length": 1}})

	if _, err := bare.UnmarshalTree(body); err == nil {
		t.Fatal("вектор принят за конструктор")
	} else if !strings.Contains(err.Error(), "ожидался конструктор") {
		t.Fatalf("ошибка %q", err)
	}
}

func asJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("значение не сериализуется: %v", err)
	}
	return string(raw)
}
