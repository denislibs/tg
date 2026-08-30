package domain

import "fmt"

// Языковой пакет: строки интерфейса, их версия и разница по версии.
//
// Подсистема целиком объявлена схемой (`langpack.*` — пять методов, пять
// конструкторов), и на бэкенде из неё до сих пор не было НИЧЕГО: переводы жили
// только в файлах клиента и уезжали в браузер чанком.
//
// Главное, что здесь выражено конструкторами, — ДВА разных предмета под одним
// объединением `LangPackString`:
//
//   - строка без числа (`langPackString`) — один текст;
//   - строка С ЧИСЛОМ (`langPackStringPluralized`) — НЕСКОЛЬКО текстов, по
//     одному на форму CLDR, и каждая форма это ОТДЕЛЬНЫЙ ПАРАМЕТР схемы;
//   - снятый ключ (`langPackStringDeleted`) — «строки больше нет», и это
//     утверждение, а не пустая строка: клиент по нему УДАЛЯЕТ ключ у себя.
//
// Формы числа отдельными параметрами — не украшение. Склеенные в одну строку с
// разделителем, они превращаются в позиционный список, порядок которого не
// проверяет никто; ровно там и путаются данные (русское «уведомлений» — это
// CLDR-`many`, а не «всё остальное»). Каждая форма названа своим именем, и
// перепутать `many` с `other` можно только явно.

// Значения дискриминатора `_` объединения LangPackString и соседей.
const (
	LangPackStringTag           = "langPackString"
	LangPackStringPluralizedTag = "langPackStringPluralized"
	LangPackStringDeletedTag    = "langPackStringDeleted"
	LangPackDifferenceTag       = "langPackDifference"
	LangPackLanguageTag         = "langPackLanguage"
)

// LangPackString — объединение схемы: строка, строка с формами числа, снятый
// ключ. Три конструктора — три ТИПА, а не один тип с полем-видом: набор
// параметров у них разный, и подделывать вид значением поля значило бы завести
// второй ответ на вопрос «что это».
type LangPackString interface {
	isLangPackString()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
	// Key — символический ключ строки; есть у всех трёх конструкторов.
	Key() string
}

// langPackString#cad181f6 key:string value:string = LangPackString;
//
// Обычная строка: ключ и текст.
//
// Имя типа не совпадает с предикатом — тем же приёмом, что у `MessageReal` и
// `UserReal`: имя объединения занято интерфейсом, и суффикс говорит, ЧЕМ этот
// конструктор отличается от соседей по объединению (текст без форм числа). Поле
// `StringKey` названо так по той же причине — `Key` занят методом интерфейса; на
// провод и в JSON оно уезжает параметром схемы `key`.
type LangPackStringPlain struct {
	Underscore string `json:"_"`
	StringKey  string `json:"key"`
	Value      string `json:"value"`
}

func (LangPackStringPlain) isLangPackString() {}
func (s LangPackStringPlain) Tag() string     { return s.Underscore }
func (s LangPackStringPlain) Key() string     { return s.StringKey }

// NewLangPackString — строка без числа.
func NewLangPackString(key, value string) LangPackStringPlain {
	return LangPackStringPlain{Underscore: LangPackStringTag, StringKey: key, Value: value}
}

// langPackStringPluralized#6c47ac9f flags:# key:string zero_value:flags.0?string
// one_value:flags.1?string two_value:flags.2?string few_value:flags.3?string
// many_value:flags.4?string other_value:string = LangPackString;
//
// Строка с формами числа. Форм в схеме шесть, и пять из них НЕОБЯЗАТЕЛЬНЫЕ:
// набор форм у каждого языка свой (у английского — `one`/`other`, у русского —
// `one`/`few`/`many`/`other`, у арабского все шесть). Отсутствие формы это
// отсутствие ПАРАМЕТРА, а не пустая строка: пустую строку клиент показал бы
// пользователю пустотой, а отсутствующую форму он ищет по правилам CLDR
// дальше.
//
// `other_value` обязателен — это форма, которой язык закрывает всё, что не
// попало в остальные. Поэтому она не указатель: значение есть всегда.
//
// Порядок полей — порядок схемы (zero, one, two, few, many, other), он же
// порядок CLDR. Кодек пишет параметры по схеме, а не по структуре, так что для
// провода порядок здесь ничего не значит; он значит для ЧИТАЮЩЕГО — форму с
// формой путают глазами.
type LangPackStringPluralized struct {
	Underscore string `json:"_"`
	StringKey  string `json:"key"`
	// Указатели, а не строки: у необязательного параметра «нет значения» и
	// «пустое значение» — разные утверждения, и на проводе TL они пишутся
	// по-разному (бит маски против записанной пустой строки).
	ZeroValue  *string `json:"zero_value,omitempty"`
	OneValue   *string `json:"one_value,omitempty"`
	TwoValue   *string `json:"two_value,omitempty"`
	FewValue   *string `json:"few_value,omitempty"`
	ManyValue  *string `json:"many_value,omitempty"`
	OtherValue string  `json:"other_value"`
}

func (LangPackStringPluralized) isLangPackString() {}
func (s LangPackStringPluralized) Tag() string     { return s.Underscore }
func (s LangPackStringPluralized) Key() string     { return s.StringKey }

// PluralForms — формы числа одной строки, каждая своим ИМЕНЕМ CLDR.
//
// Отдельный тип, а не шесть аргументов подряд: шесть строковых параметров у
// вызова — это шесть мест, где `few` встаёт на место `many` и компилятор
// молчит. С именованными полями перепутать можно только написав чужое имя.
// Имена в JSON — ИМЕНА ПАРАМЕТРОВ СХЕМЫ, а не имена полей Go: этот же тип
// уезжает в снимок словарей (internal/langsource), и форма там обязана
// называться так же, как на проводе. Переименование по дороге и есть тот шов, на
// котором `many` становится `other`.
type PluralForms struct {
	Zero  *string `json:"zero_value,omitempty"`
	One   *string `json:"one_value,omitempty"`
	Two   *string `json:"two_value,omitempty"`
	Few   *string `json:"few_value,omitempty"`
	Many  *string `json:"many_value,omitempty"`
	Other string  `json:"other_value"`
}

// NewLangPackStringPluralized — строка с формами числа.
func NewLangPackStringPluralized(key string, forms PluralForms) LangPackStringPluralized {
	return LangPackStringPluralized{
		Underscore: LangPackStringPluralizedTag,
		StringKey:  key,
		ZeroValue:  forms.Zero,
		OneValue:   forms.One,
		TwoValue:   forms.Two,
		FewValue:   forms.Few,
		ManyValue:  forms.Many,
		OtherValue: forms.Other,
	}
}

// langPackStringDeleted#2979eeb2 key:string = LangPackString;
//
// Снятый ключ. Приезжает В РАЗНИЦЕ вместо строки и означает «удали его у
// себя»: без этого конструктора клиент, однажды получивший строку, хранил бы
// её вечно — снятый перевод остался бы на экране навсегда.
type LangPackStringDeleted struct {
	Underscore string `json:"_"`
	StringKey  string `json:"key"`
}

func (LangPackStringDeleted) isLangPackString() {}
func (s LangPackStringDeleted) Tag() string     { return s.Underscore }
func (s LangPackStringDeleted) Key() string     { return s.StringKey }

// NewLangPackStringDeleted — снятый ключ.
func NewLangPackStringDeleted(key string) LangPackStringDeleted {
	return LangPackStringDeleted{Underscore: LangPackStringDeletedTag, StringKey: key}
}

// langPackDifference#f385c1f6 lang_code:string from_version:int version:int
// strings:Vector<LangPackString> = LangPackDifference;
//
// Разница языка между двумя версиями — и ЕДИНСТВЕННАЯ витрина трёх методов
// выдачи строк (`getLangPack`, `getDifference`, у оригинала ещё и апдейт
// `updateLangPack`). Полный пакет это та же разница от нуля: отдельного
// конструктора «весь пакет» в схеме нет, и он не нужен.
//
// `from_version` — версия, ОТ которой считали, `version` — до которой досчитали.
// Клиент запоминает `version` и в следующий раз присылает её обратно.
type LangPackDifference struct {
	Underscore  string           `json:"_"`
	LangCode    string           `json:"lang_code"`
	FromVersion int              `json:"from_version"`
	Version     int              `json:"version"`
	Strings     []LangPackString `json:"strings"`
}

// NewLangPackDifference — разница языка. Пустая разница это ПУСТОЙ вектор, а не
// его отсутствие: «ничего не изменилось» — такой же ответ, как список строк.
func NewLangPackDifference(langCode string, fromVersion, version int, strings []LangPackString) LangPackDifference {
	if strings == nil {
		strings = []LangPackString{}
	}
	return LangPackDifference{
		Underscore:  LangPackDifferenceTag,
		LangCode:    langCode,
		FromVersion: fromVersion,
		Version:     version,
		Strings:     strings,
	}
}

// langPackLanguage#eeca5ce3 flags:# official:flags.0?true rtl:flags.2?true
// beta:flags.3?true name:string native_name:string lang_code:string
// base_lang_code:flags.1?string plural_code:string strings_count:int
// translated_count:int translations_url:string = LangPackLanguage;
//
// Язык в списке доступных. Два имени НЕ дублируют друг друга: `name` — как язык
// зовут по-английски (им подписан список на любом языке интерфейса),
// `native_name` — как он зовёт себя сам.
//
// `plural_code` — код правил числа CLDR, по нему клиент строит
// `Intl.PluralRules` и выбирает форму. У наших языков он совпадает с
// `lang_code`, но это СВОЙСТВО ЯЗЫКА, а не тождество: у диалектов (`pt-br`)
// правила берутся у базового.
//
// `base_lang_code` — язык, из которого берётся строка, если в этом её нет. У
// нас переводы НЕПОЛНЫЕ (у русского переведено 1170 ключей из 1254, у
// остальных — около половины), и недостающее берётся из английского. Значит,
// база есть, и молчать о ней нельзя: клиент, не знающий базы, показал бы на
// месте непереведённого ключа сырой ключ.
//
// `strings_count` — сколько строк в пакете ВООБЩЕ (это свойство базы),
// `translated_count` — сколько из них переведено на этот язык. Оба считаются по
// таблице строк и колонками не лежат — см. шапку миграции 0128.
type LangPackLanguage struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Name       string          `json:"name"`
	NativeName string          `json:"native_name"`
	LangCode   string          `json:"lang_code"`
	// BaseLangCode — flags.1?string: у самой базы её нет вовсе.
	BaseLangCode    *string `json:"base_lang_code,omitempty"`
	PluralCode      string  `json:"plural_code"`
	StringsCount    int     `json:"strings_count"`
	TranslatedCount int     `json:"translated_count"`
}

// LangPackLanguageMeta — паспорт языка БЕЗ счётчиков и версии: то, что знает о
// языке источник строк, а не база. Счётчики производятся из самих строк, и
// принимать их аргументом значило бы разрешить им разъехаться со строками.
type LangPackLanguageMeta struct {
	Code       string `json:"lang_code"`
	Name       string `json:"name"`
	NativeName string `json:"native_name"`
	// BaseCode — пусто у самой базы (английского).
	BaseCode   string `json:"base_lang_code,omitempty"`
	PluralCode string `json:"plural_code"`
	// RTL — письмо справа налево. Ни у одного из наших шести языков не поднят,
	// но это свойство ЯЗЫКА, и место ему здесь, а не в условии на экране.
	RTL bool `json:"rtl,omitempty"`
}

// LangPackStringRecord — строка языка как она ХРАНИТСЯ: ключ и то, чем он
// заполнен. Не конструктор: конструктор ВЫБИРАЕТСЯ по содержимому записи
// (Constructor ниже), и выбор этот однозначен — потому что заполнено всегда
// ровно одно из трёх.
//
// Тот же тип едет в снимке словарей (internal/langsource) и ложится в колонки
// таблицы: одна форма записи на «что лежит в файле», «что лежит в базе» и «что
// уедет на провод». Три разных формы для одного предмета — это три места, где
// формы числа можно переставить местами.
type LangPackStringRecord struct {
	Key string `json:"key"`
	// Value — текст строки без числа; nil, если у строки формы.
	Value *string `json:"value,omitempty"`
	// Forms — формы числа; nil у строки без числа.
	Forms *PluralForms `json:"forms,omitempty"`
	// Deleted — ключ СНЯТ. В снимке словарей такого не бывает (снятого ключа в
	// файле просто нет); появляется он в базе, когда сид не нашёл прежний ключ
	// в источнике, и едет клиенту как `langPackStringDeleted`.
	Deleted bool `json:"deleted,omitempty"`
}

// Constructor выбирает конструктор схемы по содержимому записи.
//
// Ошибка, а не «что-нибудь по умолчанию»: запись, у которой не заполнено ничего
// (или заполнено сразу два), — это испорченные данные, и отдать вместо неё
// пустую строку значило бы показать пользователю пустоту вместо текста. В базе
// такое состояние запрещено проверкой CHECK (миграция 0128), и здесь это
// второй рубеж — для записей, пришедших не из базы.
func (r LangPackStringRecord) Constructor() (LangPackString, error) {
	switch {
	case r.Deleted:
		if r.Value != nil || r.Forms != nil {
			return nil, errLangPackRecord(r.Key, "снятый ключ несёт текст")
		}
		return NewLangPackStringDeleted(r.Key), nil
	case r.Value != nil && r.Forms != nil:
		return nil, errLangPackRecord(r.Key, "заполнены и текст, и формы числа")
	case r.Value != nil:
		return NewLangPackString(r.Key, *r.Value), nil
	case r.Forms != nil:
		return NewLangPackStringPluralized(r.Key, *r.Forms), nil
	default:
		return nil, errLangPackRecord(r.Key, "нет ни текста, ни форм числа, ни снятия")
	}
}

// SameText — совпадает ли ТЕКСТ двух записей одного ключа.
//
// По этому ответу сид решает, растить ли версию языка. Сравнение поформенное и
// с учётом ОТСУТСТВИЯ формы: «формы нет» и «форма пустая» — разные состояния, и
// склеив их, сид перестал бы замечать удаление формы из перевода.
//
// Ключ и признак снятия здесь не сравниваются намеренно: ключ у записей один по
// построению (их сопоставили по нему), а снятие — не текст, а решение сида.
func (r LangPackStringRecord) SameText(o LangPackStringRecord) bool {
	if (r.Value == nil) != (o.Value == nil) || (r.Forms == nil) != (o.Forms == nil) {
		return false
	}
	if r.Value != nil && *r.Value != *o.Value {
		return false
	}
	if r.Forms == nil {
		return true
	}
	a, b := *r.Forms, *o.Forms
	return a.Other == b.Other &&
		sameForm(a.Zero, b.Zero) && sameForm(a.One, b.One) && sameForm(a.Two, b.Two) &&
		sameForm(a.Few, b.Few) && sameForm(a.Many, b.Many)
}

func sameForm(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func errLangPackRecord(key, what string) error {
	return fmt.Errorf("langpack: строка %q — %s", key, what)
}

// NewLangPackLanguage — язык в списке доступных.
//
// `official` поднят у всех: наши языки едут ВМЕСТЕ с приложением, а не приходят
// из чужого пакета переводов. У оригинала этим флагом отличают ровно то же —
// пакет Telegram от пакета сообщества.
func NewLangPackLanguage(meta LangPackLanguageMeta, stringsCount, translatedCount int) LangPackLanguage {
	pflags := map[string]bool{"official": true}
	if meta.RTL {
		pflags["rtl"] = true
	}
	out := LangPackLanguage{
		Underscore:      LangPackLanguageTag,
		PFlags:          pflags,
		Name:            meta.Name,
		NativeName:      meta.NativeName,
		LangCode:        meta.Code,
		PluralCode:      meta.PluralCode,
		StringsCount:    stringsCount,
		TranslatedCount: translatedCount,
	}
	if meta.BaseCode != "" {
		base := meta.BaseCode
		out.BaseLangCode = &base
	}
	return out
}
