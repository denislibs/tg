package domain

import "encoding/json"

// Разметка клавиатур сообщения в форме оригинала — объединение конструкторов
// схемы TL (MTProto) с вложенными рядами, а не собственная плоская запись
// {Inline [][]InlineButton, Keyboard [][]string, Resize, OneTime}.
//
// Фаза 0 перехода на TL (docs/readiness/tl-program.md): имена конструкторов и
// полей берутся из схемы БУКВАЛЬНО (schema/schema.json), сериализация пока
// JSON. Поэтому переход к бинарному TL станет заменой сериализатора, а не
// переделкой модели.
//
// Зачем. Прежняя форма держала ДВЕ разные клавиатуры в одном объекте и
// различала их по тому, какое из двух полей непустое, — а «скрыть клавиатуру»
// кодировалось третьим состоянием того же поля (пустой непустой срез). В
// оригинале это три РАЗНЫХ конструктора одного объединения
// (replyInlineMarkup / replyKeyboardMarkup / replyKeyboardHide), и весь
// портируемый код tweb ветвится по дискриминатору: `switch(replyMarkup._)`,
// `replyMarkup._ === 'replyKeyboardHide'`. Кнопки там тоже объединение, а не
// общий тип с omitempty: «ровно один из callback/url/webapp» — это инвариант,
// который выражается конструктором, а не комментарием.
//
// ── Правила фазы 0 (те же, что у mtmedia.go и mtentity.go) ──────────────────
//   - у каждого объекта есть дискриминатор `_` со значением predicate схемы;
//   - поля `flags` в объекте НЕТ: битовая маска живёт только на проводе, кодек
//     считает её из присутствия полей;
//   - булевы флаги схемы (`flags.N?true`) собраны в под-объект `pFlags` и
//     всегда несут `true`; «выключено» — это ОТСУТСТВИЕ ключа, false не кладём;
//   - обязательные по схеме параметры сериализуются всегда, даже пустые
//     (rows, buttons, text, data — поэтому они без omitempty и нормализуются
//     из nil в пустое значение при разборе);
//   - у каждого конструктора СВОЯ структура, а не общий тип с omitempty.
//
// ── Соответствие прежней форме ──────────────────────────────────────────────
//
//	ReplyMarkup.Inline непустой  → replyInlineMarkup{rows}
//	ReplyMarkup.Keyboard непустой→ replyKeyboardMarkup{pFlags, rows, placeholder}
//	ReplyMarkup.Keyboard пустой  → replyKeyboardHide (скрыть клавиатуру)
//	ReplyMarkup.Resize           → pFlags.resize
//	ReplyMarkup.OneTime          → pFlags.single_use (имя схемы, не своё)
//	InlineButton{Callback}       → keyboardButtonCallback{text, data}
//	InlineButton{URL}            → keyboardButtonUrl{text, url}
//	InlineButton{WebApp}         → keyboardButtonWebView{text, url}
//	строка reply-клавиатуры      → keyboardButton{text}
//
// Строки в БД переписаны миграцией 0101 — постоянного переходника на чтении
// нет намеренно: он и был бы тем вторым источником истины, ради устранения
// которого делается переход.
//
// ── data:bytes ──────────────────────────────────────────────────────────────
// keyboardButtonCallback.data в схеме — `bytes`, а не строка. На фазе 0 провод
// пока JSON, и байты едут base64-строкой — ровно так же, как photoStrippedSize
// .bytes у уже переведённого медиа ([]byte + encoding/json). На фазе 2 `bytes`
// станет настоящим Uint8Array, и модель менять не придётся.
//
// ── Чего в модели НЕТ и почему ──────────────────────────────────────────────
// Параметр `style:flags.10?KeyboardButtonStyle` (оформление кнопок
// premium-ботов: bg_primary/bg_danger/bg_success/icon) предмета у нас не имеет
// — своего оформления кнопок нет ни на сервере, ни в витрине. Он необязателен,
// поэтому просто не выводится.
//
// Остальные конструкторы объединения KeyboardButton (RequestPhone,
// RequestGeoLocation, SwitchInline, Game, Buy, UrlAuth, RequestPoll,
// UserProfile, SimpleWebView, RequestPeer, Copy) предмета у нас тоже не имеют:
// сервер их никогда не производил и не хранил, а стоящие за ними механики
// (платежи, запрос телефона/геопозиции, inline-режим по кнопке, Seamless Login)
// у нас отсутствуют целиком.

// ReplyMarkup — объединение схемы: replyInlineMarkup | replyKeyboardMarkup |
// replyKeyboardHide | replyKeyboardForceReply.
type ReplyMarkup interface {
	isReplyMarkup()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// KeyboardButton — объединение схемы. Мы производим четыре конструктора:
// keyboardButton (кнопка reply-клавиатуры) | keyboardButtonCallback |
// keyboardButtonUrl | keyboardButtonWebView.
type KeyboardButton interface {
	isKeyboardButton()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
	// Caption — параметр text, обязательный у всех конструкторов объединения.
	// Имя не text, потому что так называется поле структур.
	Caption() string
}

// Значения дискриминатора `_`.
const (
	ReplyInlineMarkupTag       = "replyInlineMarkup"
	ReplyKeyboardMarkupTag     = "replyKeyboardMarkup"
	ReplyKeyboardHideTag       = "replyKeyboardHide"
	ReplyKeyboardForceReplyTag = "replyKeyboardForceReply"

	KeyboardButtonRowTag      = "keyboardButtonRow"
	KeyboardButtonTag         = "keyboardButton"
	KeyboardButtonCallbackTag = "keyboardButtonCallback"
	KeyboardButtonURLTag      = "keyboardButtonUrl"
	KeyboardButtonWebViewTag  = "keyboardButtonWebView"
)

// setPFlag выставляет булев флаг pFlags; on=false — снимает ключ, а не кладёт
// false: «выключено» это ОТСУТСТВИЕ ключа. Пустой под-объект зануляется, чтобы
// omitempty убрал его из вывода.
func setPFlag(pf *map[string]bool, name string, on bool) {
	if !on {
		delete(*pf, name)
		if len(*pf) == 0 {
			*pf = nil
		}
		return
	}
	if *pf == nil {
		*pf = map[string]bool{}
	}
	(*pf)[name] = true
}

// keepPFlags оставляет в под-объекте только объявленные схемой флаги и только
// со значением true. Клиент, приславший {"resize":false} или свой ключ, не
// должен уметь положить их в модель — иначе на фазе бинарного кодека такой флаг
// стал бы битом маски.
func keepPFlags(in map[string]bool, allowed ...string) map[string]bool {
	var out map[string]bool
	for _, name := range allowed {
		if in[name] {
			setPFlag(&out, name, true)
		}
	}
	return out
}

// ── ReplyMarkup ─────────────────────────────────────────────────────────────

// replyInlineMarkup#48a30254 rows:Vector<KeyboardButtonRow> = ReplyMarkup;
//
// Кнопки ПОД баблом. Единственный конструктор объединения без flags вовсе.
type ReplyInlineMarkup struct {
	Underscore string              `json:"_"`
	Rows       []KeyboardButtonRow `json:"rows"`
}

func (ReplyInlineMarkup) isReplyMarkup() {}
func (m ReplyInlineMarkup) Tag() string  { return m.Underscore }
func NewReplyInlineMarkup(rows []KeyboardButtonRow) ReplyInlineMarkup {
	return ReplyInlineMarkup{Underscore: ReplyInlineMarkupTag, Rows: nonNilRows(rows)}
}

func (m *ReplyInlineMarkup) UnmarshalJSON(b []byte) error {
	type plain ReplyInlineMarkup
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*m = ReplyInlineMarkup(v)
	m.Rows = nonNilRows(m.Rows)
	return nil
}

// ReplyKeyboardFlags — булевы флаги replyKeyboardMarkup в форме, удобной для
// вызова. В pFlags попадают только выставленные.
//
// SingleUse — это наш прежний OneTime: имя из схемы, а не своё.
type ReplyKeyboardFlags struct {
	Resize     bool
	SingleUse  bool
	Selective  bool
	Persistent bool
}

// replyKeyboardMarkup#85dd99d1 flags:# resize:flags.0?true single_use:flags.1?true
// selective:flags.2?true persistent:flags.4?true rows:Vector<KeyboardButtonRow>
// placeholder:flags.3?string = ReplyMarkup;
//
// Клавиатура НАД композером. placeholder необязателен (flags.3?string): пустая
// подсказка и её отсутствие — одно и то же состояние, поэтому пустую не кладём.
type ReplyKeyboardMarkup struct {
	Underscore  string              `json:"_"`
	PFlags      map[string]bool     `json:"pFlags,omitempty"`
	Rows        []KeyboardButtonRow `json:"rows"`
	Placeholder *string             `json:"placeholder,omitempty"`
}

func (ReplyKeyboardMarkup) isReplyMarkup() {}
func (m ReplyKeyboardMarkup) Tag() string  { return m.Underscore }

// Флаги клавиатуры: выставлен = ключ присутствует в pFlags.
func (m ReplyKeyboardMarkup) Resize() bool     { return m.PFlags["resize"] }
func (m ReplyKeyboardMarkup) SingleUse() bool  { return m.PFlags["single_use"] }
func (m ReplyKeyboardMarkup) Selective() bool  { return m.PFlags["selective"] }
func (m ReplyKeyboardMarkup) Persistent() bool { return m.PFlags["persistent"] }

func NewReplyKeyboardMarkup(rows []KeyboardButtonRow, f ReplyKeyboardFlags, placeholder string) ReplyKeyboardMarkup {
	m := ReplyKeyboardMarkup{Underscore: ReplyKeyboardMarkupTag, Rows: nonNilRows(rows)}
	setPFlag(&m.PFlags, "resize", f.Resize)
	setPFlag(&m.PFlags, "single_use", f.SingleUse)
	setPFlag(&m.PFlags, "selective", f.Selective)
	setPFlag(&m.PFlags, "persistent", f.Persistent)
	if placeholder != "" {
		m.Placeholder = &placeholder
	}
	return m
}

func (m *ReplyKeyboardMarkup) UnmarshalJSON(b []byte) error {
	type plain ReplyKeyboardMarkup
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*m = ReplyKeyboardMarkup(v)
	m.PFlags = keepPFlags(v.PFlags, "resize", "single_use", "selective", "persistent")
	m.Rows = nonNilRows(m.Rows)
	return nil
}

// replyKeyboardHide#a03e5b85 flags:# selective:flags.2?true = ReplyMarkup;
//
// Убрать reply-клавиатуру. В прежней форме это было третье состояние поля
// Keyboard (пустой, но не nil срез) — то есть инвариант, который нельзя было
// выразить типом.
type ReplyKeyboardHide struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
}

func (ReplyKeyboardHide) isReplyMarkup()    {}
func (m ReplyKeyboardHide) Tag() string     { return m.Underscore }
func (m ReplyKeyboardHide) Selective() bool { return m.PFlags["selective"] }

func NewReplyKeyboardHide(selective bool) ReplyKeyboardHide {
	m := ReplyKeyboardHide{Underscore: ReplyKeyboardHideTag}
	setPFlag(&m.PFlags, "selective", selective)
	return m
}

func (m *ReplyKeyboardHide) UnmarshalJSON(b []byte) error {
	type plain ReplyKeyboardHide
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*m = ReplyKeyboardHide(v)
	m.PFlags = keepPFlags(v.PFlags, "selective")
	return nil
}

// replyKeyboardForceReply#86b40b08 flags:# single_use:flags.1?true
// selective:flags.2?true placeholder:flags.3?string = ReplyMarkup;
//
// Заставить клиента открыть композер в режиме ответа на это сообщение.
type ReplyKeyboardForceReply struct {
	Underscore  string          `json:"_"`
	PFlags      map[string]bool `json:"pFlags,omitempty"`
	Placeholder *string         `json:"placeholder,omitempty"`
}

func (ReplyKeyboardForceReply) isReplyMarkup()    {}
func (m ReplyKeyboardForceReply) Tag() string     { return m.Underscore }
func (m ReplyKeyboardForceReply) SingleUse() bool { return m.PFlags["single_use"] }
func (m ReplyKeyboardForceReply) Selective() bool { return m.PFlags["selective"] }

func NewReplyKeyboardForceReply(singleUse, selective bool, placeholder string) ReplyKeyboardForceReply {
	m := ReplyKeyboardForceReply{Underscore: ReplyKeyboardForceReplyTag}
	setPFlag(&m.PFlags, "single_use", singleUse)
	setPFlag(&m.PFlags, "selective", selective)
	if placeholder != "" {
		m.Placeholder = &placeholder
	}
	return m
}

func (m *ReplyKeyboardForceReply) UnmarshalJSON(b []byte) error {
	type plain ReplyKeyboardForceReply
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*m = ReplyKeyboardForceReply(v)
	m.PFlags = keepPFlags(v.PFlags, "single_use", "selective")
	return nil
}

// ── Ряды и кнопки ───────────────────────────────────────────────────────────

// keyboardButtonRow#77608b83 buttons:Vector<KeyboardButton> = KeyboardButtonRow;
//
// Ряд — отдельный конструктор со своим дискриминатором, а не просто вложенный
// массив: [][]Button прежней формы не смог бы нести ни ряда без кнопок, ни
// будущих параметров ряда.
type KeyboardButtonRow struct {
	Underscore string          `json:"_"`
	Buttons    KeyboardButtons `json:"buttons"`
}

func NewKeyboardButtonRow(buttons ...KeyboardButton) KeyboardButtonRow {
	if buttons == nil {
		buttons = []KeyboardButton{}
	}
	return KeyboardButtonRow{Underscore: KeyboardButtonRowTag, Buttons: buttons}
}

func nonNilRows(rows []KeyboardButtonRow) []KeyboardButtonRow {
	if rows == nil {
		return []KeyboardButtonRow{}
	}
	return rows
}

// keyboardButton#7d170cff flags:# style:flags.10?KeyboardButtonStyle text:string
// = KeyboardButton;
//
// Кнопка reply-клавиатуры: нажатие отправляет её текст обычным сообщением.
// Имя структуры с суффиксом Real, потому что имя объединения (KeyboardButton)
// в Go уже занято интерфейсом — тот же приём, что у PhotoSizeReal в mtmedia.go.
type KeyboardButtonReal struct {
	Underscore string `json:"_"`
	Text       string `json:"text"`
}

func (KeyboardButtonReal) isKeyboardButton() {}
func (b KeyboardButtonReal) Tag() string     { return b.Underscore }
func (b KeyboardButtonReal) Caption() string { return b.Text }
func NewKeyboardButton(text string) KeyboardButtonReal {
	return KeyboardButtonReal{Underscore: KeyboardButtonTag, Text: text}
}

// keyboardButtonCallback#e62bc960 flags:# requires_password:flags.0?true
// style:flags.10?KeyboardButtonStyle text:string data:bytes = KeyboardButton;
//
// Data — `bytes` схемы: на JSON-проводе едет base64-строкой (см. шапку файла).
// Параметр обязателен, поэтому сериализуется всегда, даже пустой.
//
// PFlags.requires_password (кнопка требует пароль 2FA перед отправкой callback)
// объявлен, но не производится: своего 2FA-подтверждения действий у нас нет.
// Объявлен он потому, что кадр с этим флагом обязан пережить круг разбор →
// сборка, не потеряв бит.
type KeyboardButtonCallback struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Text       string          `json:"text"`
	Data       []byte          `json:"data"`
}

func (KeyboardButtonCallback) isKeyboardButton()        {}
func (b KeyboardButtonCallback) Tag() string            { return b.Underscore }
func (b KeyboardButtonCallback) Caption() string        { return b.Text }
func (b KeyboardButtonCallback) RequiresPassword() bool { return b.PFlags["requires_password"] }

func NewKeyboardButtonCallback(text string, data []byte) KeyboardButtonCallback {
	if data == nil {
		data = []byte{}
	}
	return KeyboardButtonCallback{Underscore: KeyboardButtonCallbackTag, Text: text, Data: data}
}

func (b *KeyboardButtonCallback) UnmarshalJSON(raw []byte) error {
	type plain KeyboardButtonCallback
	var v plain
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*b = KeyboardButtonCallback(v)
	b.PFlags = keepPFlags(v.PFlags, "requires_password")
	if b.Data == nil {
		b.Data = []byte{}
	}
	return nil
}

// keyboardButtonUrl#d80c25ec flags:# style:flags.10?KeyboardButtonStyle
// text:string url:string = KeyboardButton;
type KeyboardButtonURL struct {
	Underscore string `json:"_"`
	Text       string `json:"text"`
	URL        string `json:"url"`
}

func (KeyboardButtonURL) isKeyboardButton() {}
func (b KeyboardButtonURL) Tag() string     { return b.Underscore }
func (b KeyboardButtonURL) Caption() string { return b.Text }
func NewKeyboardButtonURL(text, url string) KeyboardButtonURL {
	return KeyboardButtonURL{Underscore: KeyboardButtonURLTag, Text: text, URL: url}
}

// keyboardButtonWebView#e846b1a0 flags:# style:flags.10?KeyboardButtonStyle
// text:string url:string = KeyboardButton;
//
// Открыть mini-app (наш прежний InlineButton.WebApp). Отдельный конструктор,
// а не флаг у keyboardButtonUrl: клиент открывает его в webview, а не в браузере.
type KeyboardButtonWebView struct {
	Underscore string `json:"_"`
	Text       string `json:"text"`
	URL        string `json:"url"`
}

func (KeyboardButtonWebView) isKeyboardButton() {}
func (b KeyboardButtonWebView) Tag() string     { return b.Underscore }
func (b KeyboardButtonWebView) Caption() string { return b.Text }
func NewKeyboardButtonWebView(text, url string) KeyboardButtonWebView {
	return KeyboardButtonWebView{Underscore: KeyboardButtonWebViewTag, Text: text, URL: url}
}

// KeyboardButtons — Vector<KeyboardButton>. Именованный тип нужен ровно ради
// UnmarshalJSON: в объединение по дискриминатору encoding/json сам не умеет.
type KeyboardButtons []KeyboardButton

// UnmarshalJSON разбирает вектор, ветвясь по дискриминатору `_`.
//
// Кнопка с НЕИЗВЕСТНЫМ (или отсутствующим) `_` отбрасывается, а не роняет весь
// ряд: разметку присылает бот, и потеря одной кнопки из чужого будущего слоя
// лучше, чем потеря всей клавиатуры. Сюда же попадает старая плоская запись
// {"text":…,"callback":…} — у неё нет `_`.
func (bs *KeyboardButtons) UnmarshalJSON(raw []byte) error {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return err
	}
	// buttons — обязательный параметр ряда: пустой вектор это [], а не null.
	out := make(KeyboardButtons, 0, len(items))
	for _, item := range items {
		b, err := decodeKeyboardButton(item)
		if err != nil {
			return err
		}
		if b != nil {
			out = append(out, b)
		}
	}
	*bs = out
	return nil
}

// decodeKeyboardButton разбирает одну кнопку; (nil, nil) — конструктор нам
// неизвестен.
func decodeKeyboardButton(raw json.RawMessage) (KeyboardButton, error) {
	var head struct {
		Underscore string `json:"_"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, err
	}
	switch head.Underscore {
	case KeyboardButtonTag:
		return unmarshalButton[KeyboardButtonReal](raw)
	case KeyboardButtonCallbackTag:
		return unmarshalButton[KeyboardButtonCallback](raw)
	case KeyboardButtonURLTag:
		return unmarshalButton[KeyboardButtonURL](raw)
	case KeyboardButtonWebViewTag:
		return unmarshalButton[KeyboardButtonWebView](raw)
	}
	return nil, nil
}

func unmarshalButton[T KeyboardButton](raw json.RawMessage) (KeyboardButton, error) {
	var b T
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, err
	}
	return b, nil
}

// UnmarshalReplyMarkup разбирает объединение ReplyMarkup, ветвясь по
// дискриминатору `_`. Неизвестный (или отсутствующий) конструктор — nil, nil:
// сообщение приезжает без клавиатуры, а не роняет разбор всей истории. Сюда же
// попадает старая форма {"inline":[…]} — у неё нет `_`.
//
// Отдельная функция, а не UnmarshalJSON на именованном типе: у объединения нет
// вектора-обёртки, поле сообщения — одиночное значение интерфейса.
func UnmarshalReplyMarkup(raw []byte) (ReplyMarkup, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var head struct {
		Underscore string `json:"_"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, err
	}
	switch head.Underscore {
	case ReplyInlineMarkupTag:
		var m ReplyInlineMarkup
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, err
		}
		return m, nil
	case ReplyKeyboardMarkupTag:
		var m ReplyKeyboardMarkup
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, err
		}
		return m, nil
	case ReplyKeyboardHideTag:
		var m ReplyKeyboardHide
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, err
		}
		return m, nil
	case ReplyKeyboardForceReplyTag:
		var m ReplyKeyboardForceReply
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, err
		}
		return m, nil
	}
	return nil, nil
}
