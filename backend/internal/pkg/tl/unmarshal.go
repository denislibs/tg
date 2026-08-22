package tl

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
)

// Unmarshal разбирает тело TL и раскладывает результат в v.
//
// Разбор идёт в ту же промежуточную форму, из которой собирается запись, —
// дерево map/[]any с дискриминатором `_` и под-объектом `pFlags`, — а оттуда в
// значение через encoding/json. Дискриминатор при этом не «поле в данных»: на
// проводе его нет, он восстанавливается из числового id конструктора, как и у
// оригинала.
//
// Отдельного разборщика на каждый конструктор нет и не будет по той же
// причине, по какой его нет у записи: раскладку знает схема.
func (codec *Codec) Unmarshal(body []byte, v any) error {
	node, err := codec.UnmarshalTree(body)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(node)
	if err != nil {
		return fmt.Errorf("tl: разобранное дерево не сериализуется: %w", err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("tl: разобранное дерево не раскладывается в %T: %w", v, err)
	}
	return nil
}

// UnmarshalTree разбирает тело TL в дерево map/[]any.
//
// Форма дерева совпадает с JSON-формой модели ровно затем, чтобы round-trip
// сравнивался механически: собрали значение, разобрали обратно — расхождение
// видно как разница двух JSON, а не как «где-то поехало».
func (codec *Codec) UnmarshalTree(body []byte) (map[string]any, error) {
	r := NewReader(body)
	obj, err := codec.decodeBoxed(r, "")
	if err != nil {
		return nil, err
	}
	if r.Remaining() != 0 {
		return nil, fmt.Errorf("tl: после разбора осталось %d байт", r.Remaining())
	}
	return obj, nil
}

// decodeBoxed читает конструктор вместе с его числовым id.
func (codec *Codec) decodeBoxed(r *Reader, want string) (map[string]any, error) {
	id, err := r.ConstructorID()
	if err != nil {
		return nil, err
	}
	c, ok := ConstructorByID(id)
	if !ok {
		return nil, fmt.Errorf("tl: конструктора %#08x нет в схеме", uint32(id))
	}
	if want != "" && c.Type != want {
		return nil, fmt.Errorf("tl: на месте %s пришёл %s из объединения %s", want, c.Predicate, c.Type)
	}

	obj := map[string]any{"_": c.Predicate}
	pflags := map[string]any{}
	masks := map[string]Flags{}

	for _, p := range c.Params {
		if p.Type == "#" {
			mask, err := r.Int()
			if err != nil {
				return nil, fmt.Errorf("%s.%s: %w", c.Predicate, p.Name, err)
			}
			masks[p.Name] = Flags(uint32(mask))
			continue
		}

		if p.Optional() {
			mask, ok := masks[p.Flags]
			if !ok {
				return nil, fmt.Errorf("tl: %s.%s ссылается на маску %s, объявленную позже", c.Predicate, p.Name, p.Flags)
			}
			if !mask.Has(p.Bit) {
				continue
			}
			if p.Type == "true" {
				// Голый флаг на проводе не занимает ничего: значение целиком в
				// бите. «Выключено» — отсутствие ключа, поэтому false сюда не
				// кладётся никогда.
				pflags[p.Name] = true
				continue
			}
		}

		val, err := codec.decodeValue(r, p.Type)
		if err != nil {
			return nil, fmt.Errorf("%s.%s: %w", c.Predicate, p.Name, err)
		}
		if codec.isStubbed(c.Predicate, p.Name) {
			// Заглушка занимает место в потоке, но предмета у неё нет: в модель
			// она не попадает, иначе round-trip показывал бы поле, которого
			// модель не производит.
			continue
		}
		obj[p.Name] = val
	}

	if len(pflags) > 0 {
		obj["pFlags"] = pflags
	}
	return obj, nil
}

// decodeValue читает значение параметра по объявленному типу.
func (codec *Codec) decodeValue(r *Reader, typ string) (any, error) {
	switch typ {
	case "int":
		v, err := r.Int()
		return json.Number(strconv.FormatInt(int64(v), 10)), err
	case "long":
		v, err := r.Long()
		return json.Number(strconv.FormatInt(v, 10)), err
	case "double":
		v, err := r.Double()
		return json.Number(strconv.FormatFloat(v, 'g', -1, 64)), err
	case "string":
		return r.String()
	case "bytes":
		b, err := r.Bytes()
		if err != nil {
			return nil, err
		}
		// Байты возвращаются строкой base64 — той же формой, в какой их
		// печатает encoding/json для []byte. Иначе round-trip разошёлся бы на
		// представлении, а не на содержимом.
		return base64.StdEncoding.EncodeToString(b), nil
	case "Bool":
		return r.Bool()
	case "true":
		return nil, errNakedTrue
	case "#":
		return nil, errMaskAsValue
	}

	if inner, ok := vectorElem(typ); ok {
		n, err := r.VectorHeader()
		if err != nil {
			return nil, err
		}
		items := make([]any, 0, n)
		for i := 0; i < n; i++ {
			item, err := codec.decodeValue(r, inner)
			if err != nil {
				return nil, fmt.Errorf("элемент %d: %w", i, err)
			}
			items = append(items, item)
		}
		return items, nil
	}

	return codec.decodeBoxed(r, typ)
}
