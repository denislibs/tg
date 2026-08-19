package domain

import "encoding/json"

// Сущности форматирования сообщения в форме оригинала — объединение
// конструкторов схемы TL (MTProto), а не плоская запись со своим набором
// строк-типов.
//
// Фаза 0 перехода на TL (docs/readiness/tl-program.md): имена конструкторов и
// полей берутся из схемы БУКВАЛЬНО (schema/schema.json), сериализация пока
// JSON. Поэтому переход к бинарному TL станет заменой сериализатора, а не
// переделкой модели.
//
// Зачем. Плоская запись {type, offset, length, url, language, user_id,
// document_id} — это общий тип с omitempty: по ней нельзя отличить «поля здесь
// нет вовсе» от «поле есть и пустое». Для messageEntityPre.language разница
// предметная: в схеме параметр ОБЯЗАТЕЛЕН и едет на провод всегда, даже пустой,
// а у text_link его нет в принципе. Кроме того, весь портируемый код tweb
// ветвится по дискриминатору (`switch(entity._)`, wrapRichText,
// combineSameEntities) — при совпадении формы он портируется буквально.
//
// ── Правила фазы 0 (те же, что у mtmedia.go) ────────────────────────────────
//   - у каждого объекта есть дискриминатор `_` со значением predicate схемы;
//   - поля `flags` в объекте НЕТ: битовая маска живёт только на проводе, кодек
//     считает её из присутствия полей;
//   - булевы флаги схемы (`flags.N?true`) собраны в под-объект `pFlags` и
//     всегда несут `true`; «выключено» — это ОТСУТСТВИЕ ключа, false не кладём;
//   - обязательные по схеме параметры сериализуются всегда, даже нулевые;
//     flags-параметры — только когда есть;
//   - у каждого конструктора СВОЯ структура, а не общий тип с omitempty.
//
// ── Соответствие прежним строкам-типам ──────────────────────────────────────
//
//	bold → messageEntityBold, italic → messageEntityItalic,
//	underline → messageEntityUnderline, strikethrough → messageEntityStrike,
//	code → messageEntityCode, pre → messageEntityPre,
//	spoiler → messageEntitySpoiler, blockquote → messageEntityBlockquote,
//	text_link → messageEntityTextUrl, text_mention → messageEntityMentionName,
//	custom_emoji → messageEntityCustomEmoji.
//
// Строки в БД переписаны миграцией 0100 — постоянного переходника на чтении
// нет намеренно: он и был бы тем вторым источником истины, ради устранения
// которого делается переход.
//
// ── Чего в модели НЕТ и почему ──────────────────────────────────────────────
// Остальные конструкторы объединения MessageEntity (messageEntityMention,
// Hashtag, BotCommand, Url, Email, Phone, Cashtag, BankCard, Unknown) предмета
// у нас не имеют: это подсветка, которую клиент выводит из САМОГО текста
// регулярками (tweb parseEntities), а не хранимая разметка. Сервер их никогда
// не производил и не хранил. Диффовые (DiffInsert/DiffReplace/DiffDelete) и
// messageEntityFormattedDate предмета не имеют тем более — их производят
// функции, которых у нас нет.

// MessageEntity — объединение схемы: messageEntityBold | messageEntityItalic |
// messageEntityUnderline | messageEntityStrike | messageEntityCode |
// messageEntityPre | messageEntitySpoiler | messageEntityBlockquote |
// messageEntityTextUrl | messageEntityMentionName | messageEntityCustomEmoji.
//
// Offset/Length у ВСЕХ конструкторов объединения — в кодовых единицах UTF-16
// (как индексы строки в JS), поэтому одни и те же числа режут текст одинаково
// на обоих концах. Отсюда Span() в интерфейсе: он есть у каждого варианта,
// и потребителю (санитайзеру) не нужен на них type switch.
type MessageEntity interface {
	isMessageEntity()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
	// Span — offset и length сущности в кодовых единицах UTF-16.
	Span() (offset, length int)
}

// Значения дискриминатора `_`.
const (
	EntityBold        = "messageEntityBold"
	EntityItalic      = "messageEntityItalic"
	EntityUnderline   = "messageEntityUnderline"
	EntityStrike      = "messageEntityStrike"
	EntityCode        = "messageEntityCode"
	EntityPre         = "messageEntityPre"
	EntitySpoiler     = "messageEntitySpoiler"
	EntityBlockquote  = "messageEntityBlockquote"
	EntityTextURL     = "messageEntityTextUrl"
	EntityMentionName = "messageEntityMentionName"
	EntityCustomEmoji = "messageEntityCustomEmoji"
)

// messageEntityBold#bd610bc9 offset:int length:int = MessageEntity;
type MessageEntityBold struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
}

func (MessageEntityBold) isMessageEntity()   {}
func (e MessageEntityBold) Tag() string      { return e.Underscore }
func (e MessageEntityBold) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntityBold(offset, length int) MessageEntityBold {
	return MessageEntityBold{Underscore: EntityBold, Offset: offset, Length: length}
}

// messageEntityItalic#826f8b60 offset:int length:int = MessageEntity;
type MessageEntityItalic struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
}

func (MessageEntityItalic) isMessageEntity()   {}
func (e MessageEntityItalic) Tag() string      { return e.Underscore }
func (e MessageEntityItalic) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntityItalic(offset, length int) MessageEntityItalic {
	return MessageEntityItalic{Underscore: EntityItalic, Offset: offset, Length: length}
}

// messageEntityUnderline#9c4e7e8b offset:int length:int = MessageEntity;
type MessageEntityUnderline struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
}

func (MessageEntityUnderline) isMessageEntity()   {}
func (e MessageEntityUnderline) Tag() string      { return e.Underscore }
func (e MessageEntityUnderline) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntityUnderline(offset, length int) MessageEntityUnderline {
	return MessageEntityUnderline{Underscore: EntityUnderline, Offset: offset, Length: length}
}

// messageEntityStrike#bf0693d4 offset:int length:int = MessageEntity;
type MessageEntityStrike struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
}

func (MessageEntityStrike) isMessageEntity()   {}
func (e MessageEntityStrike) Tag() string      { return e.Underscore }
func (e MessageEntityStrike) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntityStrike(offset, length int) MessageEntityStrike {
	return MessageEntityStrike{Underscore: EntityStrike, Offset: offset, Length: length}
}

// messageEntityCode#28a20571 offset:int length:int = MessageEntity;
type MessageEntityCode struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
}

func (MessageEntityCode) isMessageEntity()   {}
func (e MessageEntityCode) Tag() string      { return e.Underscore }
func (e MessageEntityCode) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntityCode(offset, length int) MessageEntityCode {
	return MessageEntityCode{Underscore: EntityCode, Offset: offset, Length: length}
}

// messageEntityPre#73924be0 offset:int length:int language:string = MessageEntity;
//
// language в схеме ОБЯЗАТЕЛЕН: у блока кода без подсказки языка он едет пустой
// строкой, а не отсутствует. Поэтому без omitempty — иначе на фазе бинарного
// кодека пустая подсказка и её отсутствие стали бы разными кадрами.
type MessageEntityPre struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
	Language   string `json:"language"`
}

func (MessageEntityPre) isMessageEntity()   {}
func (e MessageEntityPre) Tag() string      { return e.Underscore }
func (e MessageEntityPre) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntityPre(offset, length int, language string) MessageEntityPre {
	return MessageEntityPre{Underscore: EntityPre, Offset: offset, Length: length, Language: language}
}

// messageEntitySpoiler#32ca960f offset:int length:int = MessageEntity;
type MessageEntitySpoiler struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
}

func (MessageEntitySpoiler) isMessageEntity()   {}
func (e MessageEntitySpoiler) Tag() string      { return e.Underscore }
func (e MessageEntitySpoiler) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntitySpoiler(offset, length int) MessageEntitySpoiler {
	return MessageEntitySpoiler{Underscore: EntitySpoiler, Offset: offset, Length: length}
}

// messageEntityBlockquote#f1ccaaac flags:# collapsed:flags.0?true offset:int
// length:int = MessageEntity;
//
// PFlags.collapsed — свёрнутая цитата (tweb рисует её с кнопкой «развернуть»).
// Отсутствие ключа = развёрнутая: false не кладём.
type MessageEntityBlockquote struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Offset     int             `json:"offset"`
	Length     int             `json:"length"`
}

func (MessageEntityBlockquote) isMessageEntity()   {}
func (e MessageEntityBlockquote) Tag() string      { return e.Underscore }
func (e MessageEntityBlockquote) Span() (int, int) { return e.Offset, e.Length }

// Collapsed — цитата свёрнута (pFlags.collapsed выставлен).
func (e MessageEntityBlockquote) Collapsed() bool { return e.PFlags["collapsed"] }

// UnmarshalJSON приводит pFlags к инварианту модели: в под-объекте остаётся
// только объявленный схемой флаг и только со значением true. Клиент, приславший
// {"collapsed":false} или свой ключ, не должен уметь положить их в модель —
// иначе на фазе бинарного кодека такой флаг стал бы битом маски.
func (e *MessageEntityBlockquote) UnmarshalJSON(b []byte) error {
	type plain MessageEntityBlockquote
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*e = MessageEntityBlockquote(v)
	e.PFlags = nil
	if v.PFlags["collapsed"] {
		e.PFlags = map[string]bool{"collapsed": true}
	}
	return nil
}

func NewMessageEntityBlockquote(offset, length int, collapsed bool) MessageEntityBlockquote {
	e := MessageEntityBlockquote{Underscore: EntityBlockquote, Offset: offset, Length: length}
	if collapsed {
		e.PFlags = map[string]bool{"collapsed": true}
	}
	return e
}

// messageEntityTextUrl#76a6d327 offset:int length:int url:string = MessageEntity;
type MessageEntityTextURL struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
	URL        string `json:"url"`
}

func (MessageEntityTextURL) isMessageEntity()   {}
func (e MessageEntityTextURL) Tag() string      { return e.Underscore }
func (e MessageEntityTextURL) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntityTextURL(offset, length int, url string) MessageEntityTextURL {
	return MessageEntityTextURL{Underscore: EntityTextURL, Offset: offset, Length: length, URL: url}
}

// messageEntityMentionName#dc7b1140 offset:int length:int user_id:long
// = MessageEntity;
//
// Упоминание пользователя БЕЗ username: id едет прямо в сущности. Обычное
// «@username» — messageEntityMention, его клиент выводит из текста сам, у нас
// оно не хранится.
type MessageEntityMentionName struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
	UserID     int64  `json:"user_id"`
}

func (MessageEntityMentionName) isMessageEntity()   {}
func (e MessageEntityMentionName) Tag() string      { return e.Underscore }
func (e MessageEntityMentionName) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntityMentionName(offset, length int, userID int64) MessageEntityMentionName {
	return MessageEntityMentionName{Underscore: EntityMentionName, Offset: offset, Length: length, UserID: userID}
}

// messageEntityCustomEmoji#c8cf05f8 offset:int length:int document_id:long
// = MessageEntity;
type MessageEntityCustomEmoji struct {
	Underscore string `json:"_"`
	Offset     int    `json:"offset"`
	Length     int    `json:"length"`
	DocumentID int64  `json:"document_id"`
}

func (MessageEntityCustomEmoji) isMessageEntity()   {}
func (e MessageEntityCustomEmoji) Tag() string      { return e.Underscore }
func (e MessageEntityCustomEmoji) Span() (int, int) { return e.Offset, e.Length }
func NewMessageEntityCustomEmoji(offset, length int, documentID int64) MessageEntityCustomEmoji {
	return MessageEntityCustomEmoji{Underscore: EntityCustomEmoji, Offset: offset, Length: length, DocumentID: documentID}
}

// MessageEntities — разметка сообщения: Vector<MessageEntity>.
//
// Именованный тип нужен ровно ради UnmarshalJSON: в объединение по
// дискриминатору encoding/json сам не умеет, а сущности приходят и из jsonb, и
// из тела запроса.
type MessageEntities []MessageEntity

// UnmarshalJSON разбирает вектор, ветвясь по дискриминатору `_`.
//
// Элемент с НЕИЗВЕСТНЫМ (или отсутствующим) `_` отбрасывается, а не роняет весь
// вектор: разметку присылает клиент, и потеря одной сущности из чужого будущего
// слоя лучше, чем потеря всей разметки сообщения. Сюда же попадает старая
// плоская запись {"type":"bold",…} — у неё нет `_`, поэтому непереписанная
// строка теряет форматирование, но не читается как что-то другое.
func (es *MessageEntities) UnmarshalJSON(b []byte) error {
	var raws []json.RawMessage
	if err := json.Unmarshal(b, &raws); err != nil {
		return err
	}
	if len(raws) == 0 {
		*es = nil
		return nil
	}
	out := make(MessageEntities, 0, len(raws))
	for _, raw := range raws {
		e, err := decodeMessageEntity(raw)
		if err != nil {
			return err
		}
		if e != nil {
			out = append(out, e)
		}
	}
	if len(out) == 0 {
		*es = nil
		return nil
	}
	*es = out
	return nil
}

// decodeMessageEntity разбирает одну сущность; (nil, nil) — конструктор нам
// неизвестен.
func decodeMessageEntity(raw json.RawMessage) (MessageEntity, error) {
	var head struct {
		Underscore string `json:"_"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, err
	}
	switch head.Underscore {
	case EntityBold:
		return unmarshalEntity[MessageEntityBold](raw)
	case EntityItalic:
		return unmarshalEntity[MessageEntityItalic](raw)
	case EntityUnderline:
		return unmarshalEntity[MessageEntityUnderline](raw)
	case EntityStrike:
		return unmarshalEntity[MessageEntityStrike](raw)
	case EntityCode:
		return unmarshalEntity[MessageEntityCode](raw)
	case EntityPre:
		return unmarshalEntity[MessageEntityPre](raw)
	case EntitySpoiler:
		return unmarshalEntity[MessageEntitySpoiler](raw)
	case EntityBlockquote:
		return unmarshalEntity[MessageEntityBlockquote](raw)
	case EntityTextURL:
		return unmarshalEntity[MessageEntityTextURL](raw)
	case EntityMentionName:
		return unmarshalEntity[MessageEntityMentionName](raw)
	case EntityCustomEmoji:
		return unmarshalEntity[MessageEntityCustomEmoji](raw)
	}
	return nil, nil
}

func unmarshalEntity[T MessageEntity](raw json.RawMessage) (MessageEntity, error) {
	var e T
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, err
	}
	return e, nil
}
