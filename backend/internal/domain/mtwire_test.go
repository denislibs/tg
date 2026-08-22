package domain

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Эталонные байты провода, собранные из НАСТОЯЩИХ значений модели.
//
// Сверки *_schema_test.go отвечают на вопрос «те ли у нас имена полей»; здесь
// проверяется то, чего они не проверяют вовсе, — раскладка: порядок, длины,
// выравнивание и значение маски. Эталон общий (schema/testdata/tl-golden.json):
// ту же строку разбирает НЕИЗМЕНЁННЫЙ десериализатор tweb
// (web-client/scripts/crosscheck). Разъехаться незаметно нельзя — эталон один,
// а проверяют его две независимые реализации.
func TestWire_GoldenFromModel(t *testing.T) {
	cases := []struct {
		golden string
		value  any
	}{
		{"photoStrippedSize", NewPhotoStrippedSize([]byte{1, 2, 3})},
		{"messageEntityBold", NewMessageEntityBold(5, 11)},
		{"messageEntityTextUrl", NewMessageEntityTextURL(0, 4, "https://example.org")},
		// Свёрнутая цитата: бит маски поднят присутствием ключа в pFlags.
		{"messageEntityBlockquoteCollapsed", NewMessageEntityBlockquote(2, 30, true)},
		// Она же развёрнутая: длина записи ТА ЖЕ, флаг нигде не материализуется.
		{"messageEntityBlockquotePlain", NewMessageEntityBlockquote(2, 30, false)},
		{"replyInlineMarkup", NewReplyInlineMarkup([]KeyboardButtonRow{
			NewKeyboardButtonRow(
				NewKeyboardButton("ok"),
				NewKeyboardButtonURL("go", "https://a.io"),
			),
		})},
	}

	for _, c := range cases {
		t.Run(c.golden, func(t *testing.T) {
			body, err := WireCodec.Marshal(c.value)
			if err != nil {
				t.Fatalf("кодек не собрал значение: %v", err)
			}
			if got, want := hex.EncodeToString(body), goldenHex(t, c.golden); got != want {
				t.Fatalf("байты разошлись с общим эталоном\n получили %s\n ожидали  %s", got, want)
			}
		})
	}
}

// Целый документ — самый содержательный вектор из всех: в нём разом сходятся
// НАЗВАННЫЕ заглушки транспорта, маска, ступень превью, вектор атрибутов и
// вложенное объединение InputStickerSet.
//
// Заглушки берутся из ТОГО ЖЕ списка, которым сверки объявляют «предмета нет»
// (OmittedWithoutSubject). Здесь проверяется вторая половина утверждения — «а
// что пишется вместо»: обязательный параметр занимает своё место в потоке,
// поэтому все последующие поля остаются на своих позициях. Что раскладка верна
// не только по-нашему, показывает та же строка эталона в crosscheck: её
// разбирает неизменённый десериализатор tweb.
func TestWire_StickerDocumentGolden(t *testing.T) {
	doc := BuildDocument(MediaSource{
		MediaID: 77, Kind: "sticker", Mime: "application/x-tgsticker",
		Size: 4096, Width: 512, Height: 512, StickerAlt: "😀", StickerSetID: 5,
		Blur: []byte{1, 2, 3},
	})

	body, err := WireCodec.Marshal(doc)
	if err != nil {
		t.Fatalf("кодек не собрал документ: %v", err)
	}
	if got, want := hex.EncodeToString(body), goldenHex(t, "documentSticker"); got != want {
		t.Fatalf("байты документа разошлись с общим эталоном\n получили %s\n ожидали  %s", got, want)
	}
}

// goldenHex достаёт эталонные байты вектора из общего файла.
func goldenHex(t *testing.T, name string) string {
	t.Helper()

	// backend/internal/domain → корень репозитория.
	path := filepath.Join("..", "..", "..", "schema", "testdata", "tl-golden.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("эталон не читается (%s): %v", path, err)
	}

	var doc struct {
		Vectors []struct {
			Name string `json:"name"`
			Hex  string `json:"hex"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("эталон не разбирается: %v", err)
	}

	for _, v := range doc.Vectors {
		if v.Name == name {
			return v.Hex
		}
	}
	t.Fatalf("вектора %q нет в эталоне", name)
	return ""
}
