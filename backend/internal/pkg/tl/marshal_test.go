package tl

import (
	"encoding/hex"
	"strings"
	"testing"
)

// Кодек ведёт схема: та же ступень превью, что писалась примитивами вручную,
// теперь собирается из значения модели — и байты обязаны совпасть с ОБЩИМ
// эталоном, который на другом конце разбирает неизменённый десериализатор tweb.
func TestMarshal_GoldenFromValue(t *testing.T) {
	cases := []struct {
		golden string
		value  any
	}{
		{
			golden: "photoStrippedSize",
			// bytes едут строкой base64 — так их печатает encoding/json для
			// []byte, и в этой же форме они лежат на JSON-проводе фазы 0.
			value: map[string]any{"_": "photoStrippedSize", "type": "i", "bytes": []byte{1, 2, 3}},
		},
		{
			golden: "messageEntityBold",
			value:  map[string]any{"_": "messageEntityBold", "offset": 5, "length": 11},
		},
		{
			golden: "messageEntityTextUrl",
			value: map[string]any{"_": "messageEntityTextUrl", "offset": 0, "length": 4,
				"url": "https://example.org"},
		},
		{
			// Свёрнутая цитата: единственный бит маски поднят присутствием
			// ключа в pFlags, а не полем на проводе.
			golden: "messageEntityBlockquoteCollapsed",
			value: map[string]any{"_": "messageEntityBlockquote", "offset": 2, "length": 30,
				"pFlags": map[string]bool{"collapsed": true}},
		},
		{
			// Та же цитата без бита: длина записи ТА ЖЕ. Материализуйся флаг
			// полем — чужой разбор поехал бы на следующем поле.
			golden: "messageEntityBlockquotePlain",
			value:  map[string]any{"_": "messageEntityBlockquote", "offset": 2, "length": 30},
		},
		{
			// Вложенные векторы: ряды, а внутри каждого — кнопки.
			golden: "replyInlineMarkup",
			value: map[string]any{"_": "replyInlineMarkup", "rows": []any{
				map[string]any{"_": "keyboardButtonRow", "buttons": []any{
					map[string]any{"_": "keyboardButton", "text": "ok"},
					map[string]any{"_": "keyboardButtonUrl", "text": "go", "url": "https://a.io"},
				}},
			}},
		},
	}

	for _, c := range cases {
		t.Run(c.golden, func(t *testing.T) {
			body, err := Marshal(c.value)
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}
			if got, want := hex.EncodeToString(body), goldenHex(t, c.golden); got != want {
				t.Fatalf("байты разошлись с общим эталоном\n получили %s\n ожидали  %s", got, want)
			}
		})
	}
}

// Заглушки держат РАСКЛАДКУ: обязательный параметр занимает своё место в
// потоке, потому что читающая сторона идёт по позициям, а не по именам.
// Решение «реквизитов транспорта MTProto у нас нет» при этом не отменяется.
func TestMarshal_StubsKeepLayout(t *testing.T) {
	codec := NewCodec(map[string][]string{
		"document": {"access_hash", "file_reference", "date", "dc_id"},
	})

	// id больше 2^53: через float64 младшие разряды потерялись бы молча, и на
	// проводе это выглядело бы как «файла нет», а не как ошибка кодека.
	const bigID int64 = 9007199254740993

	body, err := codec.Marshal(map[string]any{
		"_": "document", "id": bigID, "mime_type": "image/webp", "size": 12,
		"attributes": []any{},
		// Клиентское поле документа (schema_additional_params.json): на провод
		// не идёт и ошибкой не является.
		"type": "sticker",
	})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	r := NewReader(body)
	c, _ := ConstructorByPredicate("document")
	if id, _ := r.ConstructorID(); id != c.ID {
		t.Fatalf("id конструктора = %#08x", uint32(id))
	}
	if mask, _ := r.Int(); mask != 0 {
		t.Fatalf("маска = %d, а необязательных полей в значении нет", mask)
	}
	if v, _ := r.Long(); v != bigID {
		t.Fatalf("id = %d, ждали %d — разряды потеряны", v, bigID)
	}
	if v, _ := r.Long(); v != 0 {
		t.Fatalf("access_hash = %d, а заглушка обязана быть пустой", v)
	}
	if v, _ := r.Bytes(); len(v) != 0 {
		t.Fatalf("file_reference = %v, а заглушка обязана быть пустой", v)
	}
	if v, _ := r.Int(); v != 0 {
		t.Fatalf("date = %d, а заглушка обязана быть пустой", v)
	}
	if v, _ := r.String(); v != "image/webp" {
		t.Fatalf("mime_type = %q — поля разъехались по позициям", v)
	}
	if v, _ := r.Long(); v != 12 {
		t.Fatalf("size = %d", v)
	}
	if v, _ := r.Int(); v != 0 {
		t.Fatalf("dc_id = %d, а заглушка обязана быть пустой", v)
	}
	if n, err := r.VectorHeader(); err != nil || n != 0 {
		t.Fatalf("attributes: %d элементов, err = %v", n, err)
	}
	if r.Remaining() != 0 {
		t.Fatalf("после разбора осталось %d байт", r.Remaining())
	}
}

// Без объявленной заглушки пропущенный обязательный параметр — ошибка, а не
// нулевое значение. Иначе сдвиг всех последующих полей уехал бы на провод
// молча.
func TestMarshal_MissingRequiredParamIsError(t *testing.T) {
	_, err := Marshal(map[string]any{"_": "document", "id": 1, "mime_type": "x", "size": 1,
		"attributes": []any{}})
	assertError(t, err, "обязательного параметра document.access_hash нет")
}

// Конструктору заглушки нет намеренно: пустой конструктор — это ВЫБОР из
// объединения, и делать его за модель кодек не вправе.
func TestMarshal_BoxedStubIsRefused(t *testing.T) {
	codec := NewCodec(map[string][]string{"starGift": {"sticker"}})

	_, err := codec.Marshal(map[string]any{"_": "starGift", "id": 1, "stars": 1,
		"availability_remains": 1, "availability_total": 1, "convert_stars": 1})
	assertError(t, err, "заглушки для типа Document нет")
}

// Своё поле обязано быть ОБЪЯВЛЕНО в schema_additional_params.json. Без этой
// проверки оно просто не уехало бы на провод — молча, и обнаружилось бы у
// потребителя как «поле иногда пустое».
func TestMarshal_StrayFieldIsError(t *testing.T) {
	_, err := Marshal(map[string]any{"_": "messageEntityBold", "offset": 0, "length": 1,
		"выдуманное": 1})
	assertError(t, err, "не объявлено ни в схеме")

	_, err = Marshal(map[string]any{"_": "messageEntityBlockquote", "offset": 0, "length": 1,
		"pFlags": map[string]bool{"выдуманный": true}})
	assertError(t, err, "нет ни в схеме")
}

// «Выключено» — это ОТСУТСТВИЕ ключа. Записанное false и флаг, выложенный на
// верхний уровень, — ошибки модели, и молчать о них нельзя: на другом конце
// провода и то и другое выглядит как «выключено».
func TestMarshal_BoolFlagRules(t *testing.T) {
	_, err := Marshal(map[string]any{"_": "messageEntityBlockquote", "offset": 0, "length": 1,
		"pFlags": map[string]bool{"collapsed": false}})
	assertError(t, err, "«выключено» — это отсутствие ключа")

	_, err = Marshal(map[string]any{"_": "messageEntityBlockquote", "offset": 0, "length": 1,
		"collapsed": true})
	assertError(t, err, "его место — в pFlags")
}

// Маска существует только на проводе: в объекте её нет ни у оригинала, ни у
// нас. Поле `flags` в значении означает, что модель собралась диктовать маску
// вручную, — а собирается она из присутствия полей.
func TestMarshal_FlagsFieldInValueIsError(t *testing.T) {
	_, err := Marshal(map[string]any{"_": "messageEntityBlockquote", "offset": 0, "length": 1,
		"flags": 1})
	assertError(t, err, "маска на проводе собирается из присутствия полей")
}

// Конструктор не из того объединения чужой разбор прочитает как мусор, а не
// как ошибку: он идёт по позициям и про подмену не знает.
func TestMarshal_ForeignUnionMemberIsError(t *testing.T) {
	_, err := Marshal(map[string]any{"_": "replyInlineMarkup", "rows": []any{
		map[string]any{"_": "messageEntityBold", "offset": 0, "length": 1},
	}})
	assertError(t, err, "стоит messageEntityBold из объединения MessageEntity")
}

// Клиентские псевдо-конструкторы оригинала предмета на проводе не имеют, id им
// никто не назначал. Ответ «нет такого конструктора» был бы неверным: схема
// его знает.
func TestMarshal_ClientOnlyConstructorIsRefused(t *testing.T) {
	_, err := Marshal(map[string]any{"_": "messageEntityCaret", "offset": 0, "length": 0})
	assertError(t, err, "объявлен только для клиента")

	_, err = Marshal(map[string]any{"_": "выдуманныйКонструктор"})
	assertError(t, err, "нет в схеме")
}

func assertError(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("ошибки нет, а ждали %q", want)
	}
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("ошибка %q, а ждали про %q", err, want)
	}
}
