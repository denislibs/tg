package domain

import (
	"bytes"
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

// Целый КАДР реального времени — то, ради чего кодек и писался: провод WS
// переводится на TL первым.
//
// Кадр у нас был конвертом `{t: "new_message", d: {…}}` с типом СТРОКОЙ и
// курсором, дописанным рядом с телом. Здесь тип — четыре байта id конструктора,
// а `pts` — обычный параметр, как в схеме. Ту же строку эталона разбирает
// неизменённый десериализатор tweb.
func TestWire_UpdateNewMessageGolden(t *testing.T) {
	msg := MessageReal{Underscore: MessageTag, ID: 12, PeerID: NewPeerUser(7),
		Date: 1787334148, Message: "привет"}

	body, err := WireCodec.Marshal(NewUpdateNewMessage(msg, 41))
	if err != nil {
		t.Fatalf("кодек не собрал кадр: %v", err)
	}
	if got, want := hex.EncodeToString(body), goldenHex(t, "updateNewMessage"); got != want {
		t.Fatalf("байты кадра разошлись с общим эталоном\n получили %s\n ожидали  %s", got, want)
	}
}

// Круг «модель → байты → модель» на настоящих значениях.
//
// Проверка сильнее любой сверки имён: она отвечает не на вопрос «то ли поле», а
// на вопрос «доедет ли значение целиком». Разойдись раскладка — расхождение
// видно сразу и целиком, а не всплывёт потом кривой геометрией у узкого видео.
//
// Заглушки транспорта в круге НЕ участвуют намеренно: место в потоке они
// занимают, а предмета у них нет, и вернись они в модель — круг показывал бы
// поля, которых мы не производим.
func TestWire_RoundTripKeepsModel(t *testing.T) {
	values := []struct {
		name  string
		value any
	}{
		{"photoStrippedSize", NewPhotoStrippedSize([]byte{1, 2, 3})},
		{"messageEntityTextUrl", NewMessageEntityTextURL(0, 4, "https://example.org")},
		{"blockquoteCollapsed", NewMessageEntityBlockquote(2, 30, true)},
		{"blockquotePlain", NewMessageEntityBlockquote(2, 30, false)},
		{"replyInlineMarkup", NewReplyInlineMarkup([]KeyboardButtonRow{
			NewKeyboardButtonRow(
				NewKeyboardButton("ok"),
				NewKeyboardButtonURL("go", "https://a.io"),
			),
		})},
		{"documentSticker", BuildDocument(MediaSource{
			MediaID: 77, Kind: "sticker", Mime: "application/x-tgsticker",
			Size: 4096, Width: 512, Height: 512, StickerAlt: "😀", StickerSetID: 5,
			Blur: []byte{1, 2, 3},
		})},
		{"updateNewMessage", NewUpdateNewMessage(MessageReal{Underscore: MessageTag, ID: 12,
			PeerID: NewPeerUser(7), Date: 1787334148, Message: "привет"}, 41)},
		// Закрепление в круге отдельно: у него бит маски, вектор номеров и пир
		// — то есть все три механизма формата сразу.
		{"updatePinnedMessages", NewUpdatePinnedMessages(NewPeerUser(7), []int64{12, 13}, true, 47)},
		// Оно же без бита: длина записи меняется только на этом, и круг обязан
		// отличать «нет ключа» от «false».
		{"updatePinnedMessagesPlain", NewUpdatePinnedMessages(NewPeerUser(7), []int64{12}, false, 48)},
	}

	for _, c := range values {
		t.Run(c.name, func(t *testing.T) {
			body, err := WireCodec.Marshal(c.value)
			if err != nil {
				t.Fatalf("кодек не собрал значение: %v", err)
			}
			back, err := WireCodec.UnmarshalTree(body)
			if err != nil {
				t.Fatalf("кодек не разобрал собственные байты: %v", err)
			}
			if got, want := canonicalJSON(t, back), canonicalJSON(t, c.value); got != want {
				t.Fatalf("круг не сошёлся\n получили %s\n ожидали  %s", got, want)
			}
		})
	}
}

// canonicalJSON — представление значения, не зависящее от порядка полей:
// структура печатает поля в порядке объявления, карта — по алфавиту, а сравнить
// надо содержимое. Числа держатся строками (UseNumber), иначе long больше 2^53
// сравнивался бы после потери разрядов — то есть проверка молча ослабла бы
// ровно там, где она нужнее всего.
func canonicalJSON(t *testing.T, v any) string {
	t.Helper()

	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("значение не сериализуется: %v", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var node any
	if err := dec.Decode(&node); err != nil {
		t.Fatalf("значение не читается обратно: %v", err)
	}
	out, err := json.Marshal(node)
	if err != nil {
		t.Fatalf("значение не печатается канонически: %v", err)
	}
	return string(out)
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
