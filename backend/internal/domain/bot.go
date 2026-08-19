package domain

// DemoBotID — id единственного демо-бота (@demobot), сидируется миграцией.
// Реальных ботов нет: поведение зашито в usecase/chat/bot.go.
const DemoBotID int64 = 424242

// BotCommand — пункт списка команд бота (popup по «/», кнопка меню).
type BotCommand struct {
	Command     string `json:"command"` // без ведущего «/»
	Description string `json:"description"`
}

// BotCommandScope — область видимости списка команд (Telegram BotCommandScope).
// Пустой Type == "default".
type BotCommandScope struct {
	Type   string // ""|default|all_private_chats|all_group_chats|all_chat_administrators
	ChatID int64  // для chat-scope (не используется в текущем подмножестве)
}

// Norm нормализует пустой тип к «default».
func (s BotCommandScope) Norm() string {
	if s.Type == "" {
		return "default"
	}
	return s.Type
}

// Клавиатура сообщения (ReplyMarkup / KeyboardButton) живёт в mtreplymarkup.go —
// это объединение конструкторов схемы TL, а не собственная плоская запись.

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
