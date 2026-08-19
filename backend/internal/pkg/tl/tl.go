// Package tl — примитивы провода TL (Type Language), формат MTProto.
//
// Фаза 2 программы перехода на TL (docs/readiness/tl-program.md). Модель уже
// имеет форму схемы (см. domain/mtmedia.go), здесь появляется сам формат:
// вместо JSON — четыре байта числового id конструктора и поля подряд в порядке
// объявления схемы.
//
// Правила формата, перенесённые из эталонной реализации
// (tweb/src/lib/mtproto/tl_utils.ts) — на неё же будет опираться контрольный
// тест «разобрать наши байты неизменённым десериализатором tweb»:
//
//   - int      — 4 байта, little-endian, знаковый;
//   - long     — 8 байт, little-endian, знаковый (tl_utils пишет low int, затем
//     high int, что на LE и есть обычный uint64);
//   - double   — 8 байт IEEE-754, little-endian;
//   - string   — префикс длины, затем UTF-8 байты, затем выравнивание нулями до
//     кратности 4. Длина ≤ 253 — один байт; иначе байт 254 и три байта длины
//     little-endian (tl_utils.ts:184-192);
//   - bytes    — то же самое, но без предположений о кодировке;
//   - Bool     — отдельные конструкторы boolTrue/boolFalse, не 0/1;
//   - Vector<T> — id конструктора вектора, затем счётчик, затем элементы;
//   - true     — «голый» флаг: на проводе НЕ занимает ничего, его наличие
//     кодируется битом в flags (поэтому writer'а для него нет вовсе).
//
// Границы 253/254 — самое частое место ошибок в реализациях TL, поэтому они
// покрыты отдельными случаями в тестах.
package tl

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// Идентификаторы служебных конструкторов (schema/schema.json).
const (
	IDVector    int32 = 0x1cb5c415
	IDBoolTrue  int32 = -1720552011 // 0x997275b5
	IDBoolFalse int32 = -1132882121 // 0xbc799737
)

// shortLenMax — наибольшая длина, помещающаяся в однобайтовый префикс.
// Значение 254 — маркер «дальше три байта длины», 255 не используется.
const shortLenMax = 253

// ── Writer ──────────────────────────────────────────────────────────────────

// Writer собирает тело сообщения TL.
type Writer struct {
	buf []byte
}

// NewWriter создаёт writer с предвыделенным буфером.
func NewWriter(capacity int) *Writer {
	return &Writer{buf: make([]byte, 0, capacity)}
}

// Result возвращает собранное тело.
func (w *Writer) Result() []byte { return w.buf }

// Len — сколько байт уже записано.
func (w *Writer) Len() int { return len(w.buf) }

// Int пишет знаковое 32-битное.
func (w *Writer) Int(v int32) {
	w.buf = binary.LittleEndian.AppendUint32(w.buf, uint32(v))
}

// Long пишет знаковое 64-битное.
func (w *Writer) Long(v int64) {
	w.buf = binary.LittleEndian.AppendUint64(w.buf, uint64(v))
}

// Double пишет IEEE-754.
func (w *Writer) Double(v float64) {
	w.buf = binary.LittleEndian.AppendUint64(w.buf, math.Float64bits(v))
}

// ConstructorID пишет числовой id конструктора — четыре байта перед телом.
func (w *Writer) ConstructorID(id int32) { w.Int(id) }

// Bool пишет отдельный конструктор, а не число: в TL у Bool нет числового
// представления, boolTrue и boolFalse — полноценные конструкторы.
func (w *Writer) Bool(v bool) {
	if v {
		w.Int(IDBoolTrue)
		return
	}
	w.Int(IDBoolFalse)
}

// Bytes пишет байтовую строку с префиксом длины и выравниванием.
func (w *Writer) Bytes(b []byte) {
	if len(b) <= shortLenMax {
		w.buf = append(w.buf, byte(len(b)))
	} else {
		n := len(b)
		w.buf = append(w.buf, 254, byte(n), byte(n>>8), byte(n>>16))
	}
	w.buf = append(w.buf, b...)
	w.pad()
}

// String пишет строку: те же правила, что у bytes, поверх UTF-8 представления.
func (w *Writer) String(s string) { w.Bytes([]byte(s)) }

// ReserveInt резервирует место под int и возвращает функцию, которая впишет
// значение позже.
//
// Ради этого механизма всё и затевается: маска `flags` обязана лежать ПЕРЕД
// необязательными полями, а её значение известно только после того, как эти
// поля записаны (бит ставится по факту присутствия поля, а не читается из
// объекта — см. правила модели в domain/mtmedia.go). Оригинал решает это тем
// же приёмом: запоминает смещение и дописывает маску в конце
// (tl_utils.ts:397-405).
//
// Патчер индексирует буфер в момент вызова, поэтому переаллокации `append`
// между резервированием и записью безопасны.
func (w *Writer) ReserveInt() func(int32) {
	at := len(w.buf)
	w.buf = append(w.buf, 0, 0, 0, 0)
	return func(v int32) {
		binary.LittleEndian.PutUint32(w.buf[at:at+4], uint32(v))
	}
}

// Flags — битовая маска необязательных полей конструктора.
//
// В объекте её нет: она вычисляется при записи из присутствия полей и
// раскладывается обратно при чтении. Именно поэтому «выключено» в нашей модели
// значит ОТСУТСТВИЕ поля, а не false или null.
type Flags uint32

// Set поднимает бит.
func (f *Flags) Set(bit uint) { *f |= 1 << bit }

// SetIf поднимает бит, если условие выполнено — форма записи «поле есть».
func (f *Flags) SetIf(cond bool, bit uint) {
	if cond {
		f.Set(bit)
	}
}

// Has — поднят ли бит.
func (f Flags) Has(bit uint) bool { return f&(1<<bit) != 0 }

// Value — маска как знаковое int для записи на провод.
func (f Flags) Value() int32 { return int32(uint32(f)) }

// VectorHeader пишет шапку вектора: id конструктора и число элементов.
// Сами элементы пишет вызывающий — их тип знает только он.
func (w *Writer) VectorHeader(n int) {
	w.Int(IDVector)
	w.Int(int32(n))
}

// pad дописывает нули до кратности четырём.
func (w *Writer) pad() {
	for len(w.buf)%4 != 0 {
		w.buf = append(w.buf, 0)
	}
}

// ── Reader ──────────────────────────────────────────────────────────────────

// ErrShortBuffer — данных в буфере меньше, чем требует формат.
var ErrShortBuffer = errors.New("tl: буфер кончился раньше, чем разобрано значение")

// Reader разбирает тело сообщения TL.
type Reader struct {
	buf    []byte
	offset int
}

// NewReader создаёт reader поверх готового буфера.
func NewReader(b []byte) *Reader { return &Reader{buf: b} }

// Offset — текущая позиция чтения.
func (r *Reader) Offset() int { return r.offset }

// Remaining — сколько байт осталось.
func (r *Reader) Remaining() int { return len(r.buf) - r.offset }

func (r *Reader) take(n int) ([]byte, error) {
	if r.Remaining() < n {
		return nil, fmt.Errorf("%w: нужно %d байт, осталось %d", ErrShortBuffer, n, r.Remaining())
	}
	out := r.buf[r.offset : r.offset+n]
	r.offset += n
	return out, nil
}

// Int читает знаковое 32-битное.
func (r *Reader) Int() (int32, error) {
	b, err := r.take(4)
	if err != nil {
		return 0, err
	}
	return int32(binary.LittleEndian.Uint32(b)), nil
}

// Long читает знаковое 64-битное.
func (r *Reader) Long() (int64, error) {
	b, err := r.take(8)
	if err != nil {
		return 0, err
	}
	return int64(binary.LittleEndian.Uint64(b)), nil
}

// Double читает IEEE-754.
func (r *Reader) Double() (float64, error) {
	b, err := r.take(8)
	if err != nil {
		return 0, err
	}
	return math.Float64frombits(binary.LittleEndian.Uint64(b)), nil
}

// ConstructorID читает числовой id конструктора.
func (r *Reader) ConstructorID() (int32, error) { return r.Int() }

// Bool читает конструктор boolTrue/boolFalse.
func (r *Reader) Bool() (bool, error) {
	id, err := r.Int()
	if err != nil {
		return false, err
	}
	switch id {
	case IDBoolTrue:
		return true, nil
	case IDBoolFalse:
		return false, nil
	default:
		return false, fmt.Errorf("tl: на месте Bool конструктор %#08x", uint32(id))
	}
}

// Bytes читает байтовую строку и проглатывает выравнивание.
//
// Возвращает копию, а не срез входного буфера: иначе значение осталось бы
// связано с временем жизни буфера, и переиспользование буфера читателем молча
// портило бы уже разобранные данные.
func (r *Reader) Bytes() ([]byte, error) {
	head, err := r.take(1)
	if err != nil {
		return nil, err
	}

	n := int(head[0])
	if n == 254 {
		ext, err := r.take(3)
		if err != nil {
			return nil, err
		}
		n = int(ext[0]) | int(ext[1])<<8 | int(ext[2])<<16
	}

	body, err := r.take(n)
	if err != nil {
		return nil, err
	}

	out := make([]byte, n)
	copy(out, body)

	if err := r.skipPadding(); err != nil {
		return nil, err
	}
	return out, nil
}

// String читает строку теми же правилами, что и bytes.
func (r *Reader) String() (string, error) {
	b, err := r.Bytes()
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// VectorHeader читает шапку вектора и возвращает число элементов.
func (r *Reader) VectorHeader() (int, error) {
	id, err := r.Int()
	if err != nil {
		return 0, err
	}
	if id != IDVector {
		return 0, fmt.Errorf("tl: на месте вектора конструктор %#08x", uint32(id))
	}
	n, err := r.Int()
	if err != nil {
		return 0, err
	}
	if n < 0 {
		return 0, fmt.Errorf("tl: отрицательная длина вектора %d", n)
	}
	if int(n) > r.Remaining() {
		// Даже самый компактный элемент занимает хотя бы байт, поэтому счётчик
		// больше остатка буфера — заведомо испорченные данные, а не длинный
		// вектор. Без этой проверки битый счётчик заставил бы выделить память
		// под несуществующие элементы.
		return 0, fmt.Errorf("tl: длина вектора %d больше остатка буфера %d", n, r.Remaining())
	}
	return int(n), nil
}

func (r *Reader) skipPadding() error {
	for r.offset%4 != 0 {
		if r.Remaining() == 0 {
			return fmt.Errorf("%w: выравнивание не дописано", ErrShortBuffer)
		}
		r.offset++
	}
	return nil
}
