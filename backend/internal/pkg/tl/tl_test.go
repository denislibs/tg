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
