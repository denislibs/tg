package domain

import (
	"fmt"

	"github.com/messenger-denis/backend/internal/pkg/tl"
)

// Кодек TL для разметки сообщения — фаза 2 программы (docs/readiness/tl-program.md).
//
// Модель уже имеет форму схемы (mtentity.go), здесь появляется её представление
// на проводе: вместо JSON — четыре байта id конструктора и поля подряд в порядке
// объявления схемы.
//
// Импорт `internal/pkg/tl` из domain допустим: это чистый Go без зависимостей,
// такой же примитив, как encoding/json, а не адаптер.
//
// Числовые id продублированы здесь константами, но НЕ на веру: TestEntityTL_IDsMatchSchema
// сверяет каждую со `schema/schema.json`. Без этой сверки опечатка в одной цифре
// проявилась бы только тем, что чужой разбор не узнаёт конструктор.

const (
	idMessageEntityBold        int32 = -1117713463 // #bd610bc9
	idMessageEntityItalic      int32 = -2106619040 // #826f8b60
	idMessageEntityUnderline   int32 = -1672577397 // #9c4e7e8b
	idMessageEntityStrike      int32 = -1090087980 // #bf0693d4
	idMessageEntityCode        int32 = 681706865   // #28a20571
	idMessageEntityPre         int32 = 1938967520  // #73924be0
	idMessageEntitySpoiler     int32 = 852137487   // #32ca960f
	idMessageEntityBlockquote  int32 = -238245204  // #f1ccaaac
	idMessageEntityTextURL     int32 = 1990644519  // #76a6d327
	idMessageEntityMentionName int32 = -595914432  // #dc7b1140
	idMessageEntityCustomEmoji int32 = -925956616  // #c8cf05f8
)

// entityConstructorIDs — таблица «дискриминатор → id». Отдельно от кода записи,
// потому что её же читает тест сверки со схемой.
var entityConstructorIDs = map[string]int32{
	EntityBold:        idMessageEntityBold,
	EntityItalic:      idMessageEntityItalic,
	EntityUnderline:   idMessageEntityUnderline,
	EntityStrike:      idMessageEntityStrike,
	EntityCode:        idMessageEntityCode,
	EntityPre:         idMessageEntityPre,
	EntitySpoiler:     idMessageEntitySpoiler,
	EntityBlockquote:  idMessageEntityBlockquote,
	EntityTextURL:     idMessageEntityTextURL,
	EntityMentionName: idMessageEntityMentionName,
	EntityCustomEmoji: idMessageEntityCustomEmoji,
}

// EncodeEntityTL пишет одну сущность.
//
// Порядок полей — строго по схеме, и это не стилистика: читающая сторона идёт
// по тому же порядку, не имея в байтах ни имён, ни границ полей.
func EncodeEntityTL(w *tl.Writer, e MessageEntity) error {
	id, ok := entityConstructorIDs[e.Tag()]
	if !ok {
		return fmt.Errorf("tl: неизвестный конструктор сущности %q", e.Tag())
	}
	w.ConstructorID(id)

	switch v := e.(type) {
	case MessageEntityBold, MessageEntityItalic, MessageEntityUnderline,
		MessageEntityStrike, MessageEntityCode, MessageEntitySpoiler:
		offset, length := e.Span()
		w.Int(int32(offset))
		w.Int(int32(length))

	case MessageEntityPre:
		w.Int(int32(v.Offset))
		w.Int(int32(v.Length))
		// language обязателен по схеме — пишется всегда, в том числе пустым.
		w.String(v.Language)

	case MessageEntityBlockquote:
		// Маска стоит ПЕРЕД полями, а её значение известно только после того,
		// как решено, есть ли флаг: резервируем место и вписываем в конце.
		patch := w.ReserveInt()
		var flags tl.Flags
		flags.SetIf(v.Collapsed(), 0) // collapsed:flags.0?true
		w.Int(int32(v.Offset))
		w.Int(int32(v.Length))
		patch(flags.Value())

	case MessageEntityTextURL:
		w.Int(int32(v.Offset))
		w.Int(int32(v.Length))
		w.String(v.URL)

	case MessageEntityMentionName:
		w.Int(int32(v.Offset))
		w.Int(int32(v.Length))
		w.Long(v.UserID)

	case MessageEntityCustomEmoji:
		w.Int(int32(v.Offset))
		w.Int(int32(v.Length))
		w.Long(v.DocumentID)

	default:
		return fmt.Errorf("tl: нет кодека для сущности %T", e)
	}

	return nil
}

// EncodeEntitiesTL пишет разметку целиком — Vector<MessageEntity>.
func EncodeEntitiesTL(w *tl.Writer, es MessageEntities) error {
	w.VectorHeader(len(es))
	for _, e := range es {
		if err := EncodeEntityTL(w, e); err != nil {
			return err
		}
	}
	return nil
}

// DecodeEntityTL читает одну сущность.
//
// Неизвестный конструктор здесь ОШИБКА, а не пропуск — в отличие от разбора
// JSON, где элемент с чужим `_` отбрасывается. Причина в формате: длину
// неизвестного конструктора вычислить неоткуда, поэтому пропустить его нельзя,
// не потеряв синхронизацию с остатком буфера.
func DecodeEntityTL(r *tl.Reader) (MessageEntity, error) {
	id, err := r.ConstructorID()
	if err != nil {
		return nil, err
	}

	span := func() (int, int, error) {
		offset, err := r.Int()
		if err != nil {
			return 0, 0, err
		}
		length, err := r.Int()
		if err != nil {
			return 0, 0, err
		}
		return int(offset), int(length), nil
	}

	switch id {
	case idMessageEntityBold:
		o, l, err := span()
		return NewMessageEntityBold(o, l), err
	case idMessageEntityItalic:
		o, l, err := span()
		return NewMessageEntityItalic(o, l), err
	case idMessageEntityUnderline:
		o, l, err := span()
		return NewMessageEntityUnderline(o, l), err
	case idMessageEntityStrike:
		o, l, err := span()
		return NewMessageEntityStrike(o, l), err
	case idMessageEntityCode:
		o, l, err := span()
		return NewMessageEntityCode(o, l), err
	case idMessageEntitySpoiler:
		o, l, err := span()
		return NewMessageEntitySpoiler(o, l), err

	case idMessageEntityPre:
		o, l, err := span()
		if err != nil {
			return nil, err
		}
		lang, err := r.String()
		return NewMessageEntityPre(o, l, lang), err

	case idMessageEntityBlockquote:
		raw, err := r.Int()
		if err != nil {
			return nil, err
		}
		flags := tl.Flags(uint32(raw))
		o, l, err := span()
		if err != nil {
			return nil, err
		}
		return NewMessageEntityBlockquote(o, l, flags.Has(0)), nil

	case idMessageEntityTextURL:
		o, l, err := span()
		if err != nil {
			return nil, err
		}
		url, err := r.String()
		return NewMessageEntityTextURL(o, l, url), err

	case idMessageEntityMentionName:
		o, l, err := span()
		if err != nil {
			return nil, err
		}
		userID, err := r.Long()
		return NewMessageEntityMentionName(o, l, userID), err

	case idMessageEntityCustomEmoji:
		o, l, err := span()
		if err != nil {
			return nil, err
		}
		docID, err := r.Long()
		return NewMessageEntityCustomEmoji(o, l, docID), err
	}

	return nil, fmt.Errorf("tl: неизвестный конструктор сущности %#08x", uint32(id))
}

// DecodeEntitiesTL читает разметку целиком.
func DecodeEntitiesTL(r *tl.Reader) (MessageEntities, error) {
	n, err := r.VectorHeader()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, nil
	}
	out := make(MessageEntities, 0, n)
	for i := range n {
		e, err := DecodeEntityTL(r)
		if err != nil {
			return nil, fmt.Errorf("сущность %d: %w", i, err)
		}
		out = append(out, e)
	}
	return out, nil
}
