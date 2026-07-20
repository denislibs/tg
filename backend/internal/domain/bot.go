package domain

// DemoBotID — id единственного демо-бота (@demobot), сидируется миграцией.
// Реальных ботов нет: поведение зашито в usecase/chat/bot.go.
const DemoBotID int64 = 424242

// BotCommand — пункт списка команд бота (popup по «/», кнопка меню).
type BotCommand struct {
	Command     string `json:"command"` // без ведущего «/»
	Description string `json:"description"`
}

// InlineButton — кнопка inline-клавиатуры (под сообщением). Ровно один из
// Callback/URL/WebApp задан. Callback шлётся боту, URL открывает ссылку,
// WebApp открывает mini-app.
type InlineButton struct {
	Text     string `json:"text"`
	Callback string `json:"callback,omitempty"`
	URL      string `json:"url,omitempty"`
	WebApp   string `json:"webapp,omitempty"`
}

// ReplyMarkup — клавиатура сообщения (Telegram reply_markup). Inline — кнопки
// под баблом; Keyboard — reply-кнопки над композером (строки текстов).
type ReplyMarkup struct {
	Inline   [][]InlineButton `json:"inline,omitempty"`
	Keyboard [][]string       `json:"keyboard,omitempty"`
	Resize   bool             `json:"resize,omitempty"`   // подгонять высоту reply-клавиатуры
	OneTime  bool             `json:"one_time,omitempty"` // скрыть после нажатия
}

// BotCallbackAnswer — ответ бота на нажатие callback-кнопки (Telegram
// messages.getBotCallbackAnswer): всплывающий toast или alert-попап.
type BotCallbackAnswer struct {
	Text  string `json:"text,omitempty"`
	Alert bool   `json:"alert,omitempty"`
}

// InlineResult — элемент выдачи inline-режима (@bot query → список; Telegram
// botInlineResult). MVP: тип article — заголовок/описание/эмодзи-иконка; выбор
// отправляет в чат MessageText как обычное сообщение.
type InlineResult struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Emoji       string `json:"emoji,omitempty"` // иконка-заглушка вместо thumb
	MessageText string `json:"message_text"`    // что отправится в чат
}
