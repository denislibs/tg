package tl

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Эталонные байты собраны по правилам формата (см. шапку пакета) и сверены с
// реализацией tweb `tl_utils.ts`. Проверять только round-trip недостаточно:
// симметричная ошибка в writer и reader круговой прогон проходит, а совместимость
// с чужим разбором ломает — а именно чужим разбором (неизменённым
// десериализатором tweb) программа и собирается проверяться.
func TestWireFormat_GoldenBytes(t *testing.T) {
	cases := []struct {
		name  string
		write func(*Writer)
		hex   string
	}{
		{"int 1", func(w *Writer) { w.Int(1) }, "01000000"},
		{"int -1", func(w *Writer) { w.Int(-1) }, "ffffffff"},
		{"int min", func(w *Writer) { w.Int(math.MinInt32) }, "00000080"},
		{"long 1", func(w *Writer) { w.Long(1) }, "0100000000000000"},
		{"long -1", func(w *Writer) { w.Long(-1) }, "ffffffffffffffff"},
		{"double 1.5", func(w *Writer) { w.Double(1.5) }, "000000000000f83f"},
		{"boolTrue", func(w *Writer) { w.Bool(true) }, "b5757299"},
		{"boolFalse", func(w *Writer) { w.Bool(false) }, "379779bc"},
		// Пустая строка — один байт длины плюс три байта выравнивания.
		{"string пустая", func(w *Writer) { w.String("") }, "00000000"},
		// 1 + 3 = 4: выравнивание не нужно вовсе.
		{"string 3 байта", func(w *Writer) { w.String("abc") }, "03616263"},
		// 1 + 4 = 5 → добить до 8.
		{"string 4 байта", func(w *Writer) { w.String("abcd") }, "0461626364000000"},
		// UTF-8: длина считается в БАЙТАХ, а не в символах. «Ж» — два байта,
		// поэтому префикс 2, а не 1.
		{"string кириллица", func(w *Writer) { w.String("Ж") }, "02d09600"},
		{"вектор на 2", func(w *Writer) { w.VectorHeader(2) }, "15c4b51c02000000"},
		{"вектор пустой", func(w *Writer) { w.VectorHeader(0) }, "15c4b51c00000000"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := NewWriter(64)
			tc.write(w)
			got := hex.EncodeToString(w.Result())
			if got != tc.hex {
				t.Fatalf("байты разошлись с эталоном\n получили %s\n ожидали  %s", got, tc.hex)
			}
		})
	}
}

// Граница 253/254 — самое частое место ошибок в реализациях TL: до 253 длина
// занимает один байт, с 254 — маркер и три байта. Промахнуться здесь легко, а
// проявится это только на длинном поле (например, на волне голосового или
// stripped-превью), то есть далеко от места ошибки.
func TestWireFormat_LengthPrefixBoundary(t *testing.T) {
	cases := []struct {
		name     string
		length   int
		wantHead string
		wantSize int
	}{
		{"253 — ещё короткий префикс", 253, "fd", 256}, // 1 + 253 = 254 → 256
		{"254 — уже длинный префикс", 254, "fe", 260},  // 4 + 254 = 258 → 260
		{"255 — длинный префикс", 255, "fe", 260},      // 4 + 255 = 259 → 260
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload := bytes.Repeat([]byte{0xAB}, tc.length)

			w := NewWriter(0)
			w.Bytes(payload)
			out := w.Result()

			if head := hex.EncodeToString(out[:1]); head != tc.wantHead {
				t.Fatalf("префикс длины = %s, ожидали %s", head, tc.wantHead)
			}
			if len(out) != tc.wantSize {
				t.Fatalf("размер записи = %d, ожидали %d", len(out), tc.wantSize)
			}
			if len(out)%4 != 0 {
				t.Fatalf("запись не выровнена на 4: %d", len(out))
			}

			got, err := NewReader(out).Bytes()
			if err != nil {
				t.Fatalf("обратно не читается: %v", err)
			}
			if !bytes.Equal(got, payload) {
				t.Fatalf("после круга данные изменились")
			}
		})
	}
}

func TestWireFormat_RoundTrip(t *testing.T) {
	long := strings.Repeat("длинная строка ", 100)
	blob := bytes.Repeat([]byte{1, 2, 3, 4, 5}, 1000)

	w := NewWriter(0)
	w.ConstructorID(0x0BADF00D)
	w.Int(-42)
	w.Long(math.MaxInt64)
	w.Double(math.Pi)
	w.Bool(true)
	w.Bool(false)
	w.String("")
	w.String(long)
	w.Bytes(nil)
	w.Bytes(blob)
	w.VectorHeader(3)
	for i := range 3 {
		w.Int(int32(i))
	}

	r := NewReader(w.Result())

	if id, err := r.ConstructorID(); err != nil || id != 0x0BADF00D {
		t.Fatalf("id конструктора = %#x, err = %v", id, err)
	}
	if v, err := r.Int(); err != nil || v != -42 {
		t.Fatalf("int = %d, err = %v", v, err)
	}
	if v, err := r.Long(); err != nil || v != math.MaxInt64 {
		t.Fatalf("long = %d, err = %v", v, err)
	}
	if v, err := r.Double(); err != nil || v != math.Pi {
		t.Fatalf("double = %v, err = %v", v, err)
	}
	if v, err := r.Bool(); err != nil || !v {
		t.Fatalf("bool true = %v, err = %v", v, err)
	}
	if v, err := r.Bool(); err != nil || v {
		t.Fatalf("bool false = %v, err = %v", v, err)
	}
	if v, err := r.String(); err != nil || v != "" {
		t.Fatalf("пустая строка = %q, err = %v", v, err)
	}
	if v, err := r.String(); err != nil || v != long {
		t.Fatalf("длинная строка не совпала, err = %v", err)
	}
	if v, err := r.Bytes(); err != nil || len(v) != 0 {
		t.Fatalf("пустые байты = %v, err = %v", v, err)
	}
	if v, err := r.Bytes(); err != nil || !bytes.Equal(v, blob) {
		t.Fatalf("длинные байты не совпали, err = %v", err)
	}

	n, err := r.VectorHeader()
	if err != nil || n != 3 {
		t.Fatalf("длина вектора = %d, err = %v", n, err)
	}
	for i := range 3 {
		if v, err := r.Int(); err != nil || v != int32(i) {
			t.Fatalf("элемент %d = %d, err = %v", i, v, err)
		}
	}

	if r.Remaining() != 0 {
		t.Fatalf("после разбора осталось %d байт", r.Remaining())
	}
}

// Прочитанное не должно зависеть от буфера, из которого читали: иначе
// переиспользование буфера молча испортит уже разобранные значения.
func TestReader_BytesAreCopied(t *testing.T) {
	w := NewWriter(0)
	w.Bytes([]byte{1, 2, 3})
	buf := w.Result()

	got, err := NewReader(buf).Bytes()
	if err != nil {
		t.Fatalf("не читается: %v", err)
	}

	for i := range buf {
		buf[i] = 0xFF
	}

	if !bytes.Equal(got, []byte{1, 2, 3}) {
		t.Fatalf("значение изменилось вслед за буфером: %v", got)
	}
}

// Битые данные обязаны давать ошибку, а не панику и не молчаливый мусор:
// парсер стоит на границе с сетью.
func TestReader_RejectsBrokenInput(t *testing.T) {
	t.Run("буфер кончился на int", func(t *testing.T) {
		if _, err := NewReader([]byte{1, 2}).Int(); !errors.Is(err, ErrShortBuffer) {
			t.Fatalf("ожидали ErrShortBuffer, получили %v", err)
		}
	})

	t.Run("буфер кончился на теле строки", func(t *testing.T) {
		// Префикс обещает 10 байт, а их нет.
		if _, err := NewReader([]byte{10, 0, 0, 0}).String(); !errors.Is(err, ErrShortBuffer) {
			t.Fatalf("ожидали ErrShortBuffer, получили %v", err)
		}
	})

	t.Run("на месте Bool чужой конструктор", func(t *testing.T) {
		w := NewWriter(0)
		w.Int(0x12345678)
		if _, err := NewReader(w.Result()).Bool(); err == nil {
			t.Fatal("чужой конструктор на месте Bool должен быть ошибкой")
		}
	})

	t.Run("на месте вектора чужой конструктор", func(t *testing.T) {
		w := NewWriter(0)
		w.Int(0x12345678)
		w.Int(1)
		if _, err := NewReader(w.Result()).VectorHeader(); err == nil {
			t.Fatal("чужой конструктор на месте вектора должен быть ошибкой")
		}
	})

	t.Run("счётчик вектора больше остатка буфера", func(t *testing.T) {
		w := NewWriter(0)
		w.VectorHeader(1 << 20)
		if _, err := NewReader(w.Result()).VectorHeader(); err == nil {
			t.Fatal("нереальный счётчик должен быть ошибкой, а не попыткой прочитать")
		}
	})
}

// Маска flags — сердце формата: она лежит ПЕРЕД необязательными полями, а её
// значение известно только после того, как эти поля записаны. Проверяем весь
// механизм целиком на конструкторе с двумя необязательными полями, из которых
// присутствует одно.
func TestFlags_WrittenBeforeOptionalFields(t *testing.T) {
	const (
		bitTitle = 0
		bitURL   = 1
	)

	encode := func(title, url string) []byte {
		w := NewWriter(0)
		w.ConstructorID(0x0BADF00D)
		patch := w.ReserveInt() // место под flags — до полей

		var flags Flags
		flags.SetIf(title != "", bitTitle)
		flags.SetIf(url != "", bitURL)

		w.Int(7) // обязательное поле идёт после flags
		if title != "" {
			w.String(title)
		}
		if url != "" {
			w.String(url)
		}

		patch(flags.Value()) // маска вписывается в зарезервированное место
		return w.Result()
	}

	body := encode("", "https://example.org")

	r := NewReader(body)
	if _, err := r.ConstructorID(); err != nil {
		t.Fatalf("id: %v", err)
	}
	raw, err := r.Int()
	if err != nil {
		t.Fatalf("flags: %v", err)
	}
	flags := Flags(uint32(raw))

	if flags.Has(bitTitle) {
		t.Fatal("бит отсутствующего поля поднят — «выключено» обязано быть отсутствием")
	}
	if !flags.Has(bitURL) {
		t.Fatal("бит присутствующего поля не поднят")
	}

	if v, err := r.Int(); err != nil || v != 7 {
		t.Fatalf("обязательное поле = %d, err = %v", v, err)
	}
	// Пропущенное поле НЕ занимает места на проводе: сразу читается следующее.
	if v, err := r.String(); err != nil || v != "https://example.org" {
		t.Fatalf("необязательное поле = %q, err = %v", v, err)
	}
	if r.Remaining() != 0 {
		t.Fatalf("после разбора осталось %d байт", r.Remaining())
	}
}

// Эталон на настоящем конструкторе схемы, а не на отдельных примитивах.
//
// photoStrippedSize#e0b0bc2e type:string bytes:bytes = PhotoSize
//
// Ожидаемые байты лежат НЕ здесь, а в общем файле `schema/testdata/tl-golden.json`,
// потому что их проверяют две независимые реализации: этот тест собирает
// значение нашим кодеком, а `web-client/scripts/crosscheck` разбирает ту же
// строку НЕИЗМЕНЁННЫМ десериализатором tweb. Если бы эталон был записан здесь
// литералом, обе стороны могли бы разъехаться незаметно.
func TestGolden_PhotoStrippedSize(t *testing.T) {
	const idPhotoStrippedSize int32 = -525288402 // 0xe0b0bc2e

	w := NewWriter(0)
	w.ConstructorID(idPhotoStrippedSize)
	w.String("i")            // ступень stripped-плейсхолдера
	w.Bytes([]byte{1, 2, 3}) // сами байты превью

	want := goldenHex(t, "photoStrippedSize")
	got := hex.EncodeToString(w.Result())
	if got != want {
		t.Fatalf("байты конструктора разошлись с общим эталоном\n получили %s\n ожидали  %s", got, want)
	}

	// И тот же буфер обязан читаться обратно.
	r := NewReader(w.Result())
	if id, err := r.ConstructorID(); err != nil || id != idPhotoStrippedSize {
		t.Fatalf("id = %#08x, err = %v", uint32(id), err)
	}
	if v, err := r.String(); err != nil || v != "i" {
		t.Fatalf("type = %q, err = %v", v, err)
	}
	if v, err := r.Bytes(); err != nil || !bytes.Equal(v, []byte{1, 2, 3}) {
		t.Fatalf("bytes = %v, err = %v", v, err)
	}
	if r.Remaining() != 0 {
		t.Fatalf("после разбора осталось %d байт", r.Remaining())
	}
}

// goldenHex достаёт эталонные байты вектора из общего файла.
func goldenHex(t *testing.T, name string) string {
	t.Helper()

	// backend/internal/pkg/tl → корень репозитория.
	path := filepath.Join("..", "..", "..", "..", "schema", "testdata", "tl-golden.json")
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

// Сущности — вторая переведённая подсистема, и здесь эталон ловит то, чего не
// ловил на медиа: работу маски `flags` целиком. У `messageEntityBlockquote`
// маска есть, и её значение обязано сойтись у нас и у чужого разбора.
func TestGolden_Entities(t *testing.T) {
	const (
		idBold       int32 = -1117713463 // 0xbd610bc9
		idTextURL    int32 = 1990644519  // 0x76a6d327
		idBlockquote int32 = -238245204  // 0xf1ccaaac
	)

	t.Run("messageEntityBold — без необязательных полей", func(t *testing.T) {
		w := NewWriter(0)
		w.ConstructorID(idBold)
		w.Int(5)  // offset
		w.Int(11) // length

		assertGolden(t, "messageEntityBold", w)
	})

	t.Run("messageEntityTextUrl — со строкой", func(t *testing.T) {
		w := NewWriter(0)
		w.ConstructorID(idTextURL)
		w.Int(0)
		w.Int(4)
		w.String("https://example.org")

		assertGolden(t, "messageEntityTextUrl", w)
	})

	// Свёрнутая цитата: единственный бит маски поднят. Это и есть проверка
	// правила «выключено = отсутствие поля»: сам `collapsed` на проводе не
	// занимает НИЧЕГО, он существует только как бит.
	t.Run("messageEntityBlockquote — поднятый бит collapsed", func(t *testing.T) {
		w := NewWriter(0)
		w.ConstructorID(idBlockquote)
		patch := w.ReserveInt()

		var flags Flags
		flags.SetIf(true, 0) // collapsed:flags.0?true

		w.Int(2)  // offset
		w.Int(30) // length
		patch(flags.Value())

		assertGolden(t, "messageEntityBlockquoteCollapsed", w)
	})

	// Та же цитата без бита: маска нулевая, длина записи ТА ЖЕ — флаг нигде не
	// материализуется. Если бы мы писали `collapsed: false` полем, длина бы
	// выросла, и чужой разбор поехал бы на следующем поле.
	t.Run("messageEntityBlockquote — бит не поднят", func(t *testing.T) {
		w := NewWriter(0)
		w.ConstructorID(idBlockquote)
		patch := w.ReserveInt()

		var flags Flags
		flags.SetIf(false, 0)

		w.Int(2)
		w.Int(30)
		patch(flags.Value())

		assertGolden(t, "messageEntityBlockquotePlain", w)
	})
}

func assertGolden(t *testing.T, name string, w *Writer) {
	t.Helper()

	want := goldenHex(t, name)
	got := hex.EncodeToString(w.Result())
	if got != want {
		t.Fatalf("байты %s разошлись с общим эталоном\n получили %s\n ожидали  %s", name, got, want)
	}
}

// Вложенные векторы — то, чего не было ни у медиа, ни у сущностей.
//
// `replyInlineMarkup{rows: Vector<KeyboardButtonRow>}`, а внутри каждого ряда
// `Vector<KeyboardButton>`. Здесь легко ошибиться дважды: забыть id конструктора
// вектора (он пишется ПЕРЕД счётчиком) и сбиться на выравнивании строк внутри
// элементов, из-за чего поедет разбор следующего элемента, а не текущего.
func TestGolden_NestedVectors(t *testing.T) {
	const (
		idReplyInlineMarkup int32 = 1218642516 // 0x48a30254
		idKeyboardButtonRow int32 = 2002815875 // 0x77608b83
		idKeyboardButton    int32 = 2098662655 // 0x7d170cff
		idKeyboardButtonURL int32 = -670292500 // 0xd80c25ec
	)

	w := NewWriter(0)
	w.ConstructorID(idReplyInlineMarkup)
	w.VectorHeader(1) // rows

	w.ConstructorID(idKeyboardButtonRow)
	w.VectorHeader(2) // buttons

	// keyboardButton: маска пустая — необязательных полей нет вовсе.
	w.ConstructorID(idKeyboardButton)
	patchPlain := w.ReserveInt()
	w.String("ok")
	patchPlain(Flags(0).Value())

	w.ConstructorID(idKeyboardButtonURL)
	patchURL := w.ReserveInt()
	w.String("go")
	w.String("https://a.io")
	patchURL(Flags(0).Value())

	assertGolden(t, "replyInlineMarkup", w)

	// Обратный разбор — по той же структуре, включая счётчики обоих уровней.
	r := NewReader(w.Result())
	if id, err := r.ConstructorID(); err != nil || id != idReplyInlineMarkup {
		t.Fatalf("markup id = %#08x, err = %v", uint32(id), err)
	}
	rows, err := r.VectorHeader()
	if err != nil || rows != 1 {
		t.Fatalf("рядов = %d, err = %v", rows, err)
	}
	if id, err := r.ConstructorID(); err != nil || id != idKeyboardButtonRow {
		t.Fatalf("row id = %#08x, err = %v", uint32(id), err)
	}
	buttons, err := r.VectorHeader()
	if err != nil || buttons != 2 {
		t.Fatalf("кнопок = %d, err = %v", buttons, err)
	}
	if r.Remaining() == 0 {
		t.Fatal("тело кнопок не дописано")
	}
}
