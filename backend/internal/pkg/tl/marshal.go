package tl

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Codec — кодек TL с НАЗВАННЫМИ заглушками.
//
// Кодек не знает ни одной нашей структуры: раскладку полей целиком диктует
// таблица схемы (schema_gen.go), а значения берутся из значения по именам
// параметров. Поэтому новый конструктор в модели не требует ни строчки здесь —
// требуется лишь, чтобы имена полей совпадали со схемой, а это и так проверяют
// сверки *_schema_test.go на обеих сторонах провода.
//
// Заглушки — единственное, чего из схемы не выведешь, и потому единственное,
// что кодеку передаётся снаружи. Решение «реквизиты транспорта MTProto не
// производим» на JSON стоило ровно ничего: ключа нет — и всё. На проводе TL так
// нельзя: у `photo` и `document` эти параметры ОБЯЗАТЕЛЬНЫЕ, читающая сторона
// идёт по позициям, и не записать их — значит отдать чужому разбору мусор.
// Список живёт там же, где живёт само решение «предмета нет», — рядом с
// моделью (domain.OmittedWithoutSubject), а не здесь: кодек предметной области
// не знает.
type Codec struct {
	stubs map[string]map[string]bool
}

// NewCodec собирает кодек по списку параметров, значений которых у нас нет.
// Ключ — предикат конструктора, значение — имена его обязательных параметров.
func NewCodec(stubbed map[string][]string) *Codec {
	c := &Codec{stubs: make(map[string]map[string]bool, len(stubbed))}
	for predicate, names := range stubbed {
		set := make(map[string]bool, len(names))
		for _, n := range names {
			set[n] = true
		}
		c.stubs[predicate] = set
	}
	return c
}

// bare — кодек без единой заглушки: любой пропущенный обязательный параметр он
// считает ошибкой. Такой и нужен всему, что не про нашу модель.
var bare = NewCodec(nil)

// Marshal кодирует значение в тело TL кодеком без заглушек.
func Marshal(v any) ([]byte, error) { return bare.Marshal(v) }

// Marshal кодирует значение доменной модели в тело TL.
//
// Значение сначала переводится в дерево через encoding/json. Причина не в лени:
// вся семантика присутствия у модели уже выражена в терминах JSON —
// `omitempty` у необязательных полей, под-объект `pFlags`, дискриминатор `_`,
// байты строкой base64. Пройти рефлексией мимо json-тегов значило бы завести
// ВТОРОЙ ответ на вопрос «есть ли поле», и он бы разъехался с первым.
// Плата — лишняя аллокация дерева на кадр; на фазе 2 это осознанный размен,
// названный в docs/readiness/tl-program.md.
func (codec *Codec) Marshal(v any) ([]byte, error) {
	node, err := tree(v)
	if err != nil {
		return nil, err
	}
	w := NewWriter(256)
	if err := codec.encodeTop(w, node); err != nil {
		return nil, err
	}
	return w.Result(), nil
}

// encodeTop пишет ЗНАЧЕНИЕ верхнего уровня: конструктор либо вектор.
//
// Вектор здесь не поблажка, а форма самого оригинала: голым `Vector<t>`
// отвечают 39 его методов (`contacts.getStatuses = Vector<ContactStatus>`,
// `users.getUsers = Vector<User>`). Читающая сторона узнаёт вектор по его
// собственному id (`0x1cb5c415`), поэтому объявления метода для РАЗБОРА не
// требуется — ровно как в `fetchObject`.
func (codec *Codec) encodeTop(w *Writer, node any) error {
	switch n := node.(type) {
	case map[string]any:
		return codec.encodeBoxed(w, n, "")
	case []any:
		return codec.encodeTopVector(w, n)
	default:
		return fmt.Errorf("tl: на верхнем уровне значение %T — там бывает конструктор или вектор", node)
	}
}

// encodeTopVector пишет вектор верхнего уровня.
//
// Элементы обязаны быть БОКСИРОВАННЫМИ, и это не наше ограничение, а граница
// самого формата: тип элемента `Vector<int>` из потока не восстановить —
// голое число не несёт id. У оригинала его берут из объявления метода в схеме
// (`storeMethod` возвращает `methodData.type`), и пока наши ручки методами не
// объявлены (задача #67), такую витрину честнее не выпускать на провод, чем
// отдать байты, которые читающая сторона разберёт наугад.
//
// Однородность требуется по той же причине, по которой её требует тип
// `Vector<t>`: разбор идёт по объявлению места, а не по каждому элементу.
func (codec *Codec) encodeTopVector(w *Writer, items []any) error {
	w.VectorHeader(len(items))

	want := ""
	for i, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("tl: элемент %d вектора — %T; на проводе он не несёт своего типа, "+
				"а объявления метода у ручки пока нет", i, item)
		}
		if err := codec.encodeBoxed(w, obj, want); err != nil {
			return fmt.Errorf("элемент %d: %w", i, err)
		}
		if want == "" {
			predicate, _ := obj["_"].(string)
			if c, ok := ConstructorByPredicate(predicate); ok {
				want = c.Type
			}
		}
	}
	return nil
}

// isStubbed — параметр объявлен заглушкой для этого конструктора.
func (codec *Codec) isStubbed(predicate, name string) bool { return codec.stubs[predicate][name] }

// tree переводит значение в дерево map/[]any, сохраняя числа точными.
//
// UseNumber обязателен: без него `long` прошёл бы через float64 и id медиа
// больше 2^53 молча потерял бы младшие разряды — на проводе это выглядело бы
// как «файл не найден», а не как ошибка кодека.
func tree(v any) (any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("tl: значение не переводится в дерево: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var node any
	if err := dec.Decode(&node); err != nil {
		return nil, fmt.Errorf("tl: дерево значения не читается: %w", err)
	}
	return node, nil
}

// maskState — одна маска конструктора: значение собирается по ходу записи
// полей, а место под неё уже зарезервировано.
type maskState struct {
	flags Flags
	patch func(int32)
}

// encodeBoxed пишет конструктор вместе с его числовым id.
//
// want — тип, которого требует место в родителе (`Vector<PhotoSize>` требует
// PhotoSize). Проверка не формальность: подставленный не в своё объединение
// конструктор чужой разбор прочитает как мусор, а не как ошибку.
func (codec *Codec) encodeBoxed(w *Writer, node any, want string) error {
	obj, ok := node.(map[string]any)
	if !ok {
		return fmt.Errorf("tl: на месте конструктора %s значение %T", displayType(want), node)
	}

	predicate, _ := obj["_"].(string)
	if predicate == "" {
		return errors.New("tl: у объекта нет дискриминатора _")
	}

	c, ok := ConstructorByPredicate(predicate)
	if !ok {
		if IsClientOnlyPredicate(predicate) {
			return fmt.Errorf("tl: конструктор %s объявлен только для клиента, на провод он не идёт", predicate)
		}
		return fmt.Errorf("tl: конструктора %s нет в схеме", predicate)
	}
	if want != "" && c.Type != want {
		return fmt.Errorf("tl: на месте %s стоит %s из объединения %s", want, predicate, c.Type)
	}

	pflags, err := pFlagsOf(obj, predicate)
	if err != nil {
		return err
	}

	w.ConstructorID(c.ID)

	masks := map[string]*maskState{}
	for _, p := range c.Params {
		if p.Type == "#" {
			if _, present := obj[p.Name]; present {
				// Маска существует только на проводе: в объекте её нет ни у
				// оригинала, ни у нас (tl-program.md, «pFlags, а не flags»).
				return fmt.Errorf("tl: %s несёт поле %s — маска на проводе собирается из присутствия полей", predicate, p.Name)
			}
			masks[p.Name] = &maskState{patch: w.ReserveInt()}
			continue
		}

		if !p.Optional() {
			if err := codec.encodeRequired(w, predicate, p, obj); err != nil {
				return err
			}
			continue
		}

		mask, ok := masks[p.Flags]
		if !ok {
			return fmt.Errorf("tl: %s.%s ссылается на маску %s, объявленную позже", predicate, p.Name, p.Flags)
		}

		if p.Type == "true" {
			set, err := boolFlag(predicate, p.Name, obj, pflags)
			if err != nil {
				return err
			}
			mask.flags.SetIf(set, p.Bit)
			continue
		}

		val, present := obj[p.Name]
		if !present || val == nil {
			continue
		}
		mask.flags.Set(p.Bit)
		if err := codec.encodeValue(w, p.Type, val); err != nil {
			return fmt.Errorf("%s.%s: %w", predicate, p.Name, err)
		}
	}

	for _, mask := range masks {
		mask.patch(mask.flags.Value())
	}

	return checkNoStrayFields(c, obj, pflags)
}

// encodeRequired пишет обязательный параметр — или названную заглушку вместо
// него.
func (codec *Codec) encodeRequired(w *Writer, predicate string, p Param, obj map[string]any) error {
	val, present := obj[p.Name]
	if present && val != nil {
		if err := codec.encodeValue(w, p.Type, val); err != nil {
			return fmt.Errorf("%s.%s: %w", predicate, p.Name, err)
		}
		return nil
	}
	if !codec.isStubbed(predicate, p.Name) {
		return fmt.Errorf("tl: обязательного параметра %s.%s нет в значении", predicate, p.Name)
	}
	if err := writeStub(w, p.Type); err != nil {
		return fmt.Errorf("%s.%s: %w", predicate, p.Name, err)
	}
	return nil
}

// pFlagsOf достаёт под-объект булевых флагов.
func pFlagsOf(obj map[string]any, predicate string) (map[string]any, error) {
	raw, present := obj["pFlags"]
	if !present || raw == nil {
		return nil, nil
	}
	pflags, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("tl: %s.pFlags — %T, а не набор флагов", predicate, raw)
	}
	return pflags, nil
}

// boolFlag отвечает, поднят ли бит голого флага (`flags.N?true`).
//
// Такой параметр на проводе не занимает НИЧЕГО: он существует только как бит,
// поэтому и в модели живёт не полем, а ключом в pFlags. Обе ошибки модели —
// флаг на верхнем уровне и записанное false — здесь именно ошибки: молча
// пропущенный бит на другом конце провода выглядит как «выключено», и найти
// это можно будет только глазами.
func boolFlag(predicate, name string, obj, pflags map[string]any) (bool, error) {
	if _, atTop := obj[name]; atTop {
		return false, fmt.Errorf("tl: булев флаг %s.%s лежит на верхнем уровне, а его место — в pFlags", predicate, name)
	}
	raw, present := pflags[name]
	if !present {
		return false, nil
	}
	if raw != true {
		return false, fmt.Errorf("tl: %s.pFlags.%s = %v, а «выключено» — это отсутствие ключа", predicate, name, raw)
	}
	return true, nil
}

// checkNoStrayFields отвергает поля, которых нет ни в схеме, ни в списке
// клиентских.
//
// Это и есть то, ради чего механизм `schema_additional_params.json` берётся
// целиком: своё поле обязано быть ОБЪЯВЛЕНО. Без проверки оно просто не уехало
// бы на провод — молча, и обнаружилось бы у потребителя как «поле иногда
// пустое».
func checkNoStrayFields(c *Constructor, obj, pflags map[string]any) error {
	known := map[string]bool{"_": true, "pFlags": true}
	boolFlags := map[string]bool{}
	for _, p := range c.Params {
		known[p.Name] = true
		if p.Type == "true" {
			boolFlags[p.Name] = true
		}
	}

	for name := range obj {
		if known[name] || isClientParam(c.Predicate, name) {
			continue
		}
		return fmt.Errorf("tl: поле %s.%s не объявлено ни в схеме, ни в schema_additional_params.json", c.Predicate, name)
	}
	for name := range pflags {
		if boolFlags[name] || isClientParam(c.Predicate, name) {
			continue
		}
		return fmt.Errorf("tl: флага %s.pFlags.%s нет ни в схеме, ни в schema_additional_params.json", c.Predicate, name)
	}
	return nil
}

// encodeValue пишет значение параметра по объявленному типу.
func (codec *Codec) encodeValue(w *Writer, typ string, val any) error {
	switch typ {
	case "int":
		n, err := integer(val)
		if err != nil {
			return err
		}
		if n < -2147483648 || n > 2147483647 {
			return fmt.Errorf("значение %d не влезает в int", n)
		}
		w.Int(int32(n))
		return nil
	case "long":
		n, err := integer(val)
		if err != nil {
			return err
		}
		w.Long(n)
		return nil
	case "double":
		num, ok := val.(json.Number)
		if !ok {
			return fmt.Errorf("на месте double значение %T", val)
		}
		f, err := num.Float64()
		if err != nil {
			return fmt.Errorf("на месте double %q: %w", num, err)
		}
		w.Double(f)
		return nil
	case "string":
		s, ok := val.(string)
		if !ok {
			return fmt.Errorf("на месте string значение %T", val)
		}
		w.String(s)
		return nil
	case "bytes":
		// Байты доезжают сюда строкой base64 — так их печатает encoding/json
		// для []byte, и ровно в этой форме они лежат на JSON-проводе фазы 0.
		s, ok := val.(string)
		if !ok {
			return fmt.Errorf("на месте bytes значение %T, а не строка base64", val)
		}
		b, err := base64.StdEncoding.DecodeString(s)
		if err != nil {
			return fmt.Errorf("на месте bytes строка не base64: %w", err)
		}
		w.Bytes(b)
		return nil
	case "Bool":
		b, ok := val.(bool)
		if !ok {
			return fmt.Errorf("на месте Bool значение %T", val)
		}
		w.Bool(b)
		return nil
	case "true":
		return errNakedTrue
	case "#":
		return errMaskAsValue
	}

	if inner, ok := vectorElem(typ); ok {
		items, ok := val.([]any)
		if !ok {
			return fmt.Errorf("на месте %s значение %T", typ, val)
		}
		w.VectorHeader(len(items))
		for i, item := range items {
			if err := codec.encodeElem(w, inner, item); err != nil {
				return fmt.Errorf("элемент %d: %w", i, err)
			}
		}
		return nil
	}

	return codec.encodeBoxed(w, val, typ)
}

// encodeElem пишет элемент вектора: примитив — значением, объединение —
// конструктором.
func (codec *Codec) encodeElem(w *Writer, typ string, val any) error {
	if val == nil {
		return fmt.Errorf("на месте %s пусто", displayType(typ))
	}
	return codec.encodeValue(w, typ, val)
}

// vectorElem — тип элемента, если параметр объявлен вектором.
func vectorElem(typ string) (string, bool) {
	inner, ok := strings.CutPrefix(typ, "Vector<")
	if !ok {
		return "", false
	}
	return strings.TrimSuffix(inner, ">"), true
}

// integer читает целое, не теряя разрядов.
func integer(val any) (int64, error) {
	num, ok := val.(json.Number)
	if !ok {
		return 0, fmt.Errorf("на месте целого значение %T", val)
	}
	n, err := strconv.ParseInt(num.String(), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("на месте целого %q: %w", num, err)
	}
	return n, nil
}

func displayType(typ string) string {
	if typ == "" {
		return "конструктора"
	}
	return typ
}
