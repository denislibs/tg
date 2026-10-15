package domain

// DemoBotID — id единственного демо-бота (@demobot), сидируется миграцией.
// Реальных ботов нет: поведение зашито в usecase/chat/bot.go.
const DemoBotID int64 = 424242

// BotCommand — пункт списка команд бота (popup по «/», кнопка меню).
type BotCommand struct {
	Command     string `json:"command"` // без ведущего «/»
	Description string `json:"description"`
}

// Типы области видимости списка команд (Bot API BotCommandScope.type).
const (
	BotScopeDefault           = "default"
	BotScopeAllPrivateChats   = "all_private_chats"
	BotScopeAllGroupChats     = "all_group_chats"
	BotScopeAllChatAdmins     = "all_chat_administrators"
	BotScopeChat              = "chat"
	BotScopeChatAdministrator = "chat_administrators"
	BotScopeChatMember        = "chat_member"
)

// BotCommandScope — область видимости списка команд (Telegram BotCommandScope).
// Пустой Type == "default". ChatID — внутренний chats.id (chat, chat_administrators,
// chat_member), UserID — участник (chat_member); у остальных типов оба нули.
type BotCommandScope struct {
	Type   string
	ChatID int64
	UserID int64
}

// Norm нормализует пустой тип к «default».
func (s BotCommandScope) Norm() string {
	if s.Type == "" {
		return BotScopeDefault
	}
	return s.Type
}

// Valid — тип известен и адрес на месте: chat/chat_administrators требуют чат,
// chat_member — чат и пользователя; безадресным типам адрес не положен.
func (s BotCommandScope) Valid() bool {
	switch s.Norm() {
	case BotScopeDefault, BotScopeAllPrivateChats, BotScopeAllGroupChats, BotScopeAllChatAdmins:
		return s.ChatID == 0 && s.UserID == 0
	case BotScopeChat, BotScopeChatAdministrator:
		return s.ChatID != 0 && s.UserID == 0
	case BotScopeChatMember:
		return s.ChatID != 0 && s.UserID != 0
	}
	return false
}

// BotChat — чат, где состоит бот (рассылка updateBotCommands).
type BotChat struct {
	ChatID int64
	Type   string // ChatTypePrivate | ChatTypeGroup | ChatTypeChannel | ...
}

// BotGroupLists — списки команд бота (язык "") для набора групп, прочитанные
// одним запросом: безадресные скоупы, списки чата и записи chat_member. Из них
// Resolve собирает тело для рядового и для админа по приоритету Bot API без
// запросов на каждую группу.
type BotGroupLists struct {
	Global map[string][]BotCommand           // default, all_group_chats, all_chat_administrators
	Chat   map[int64]map[string][]BotCommand // chatID -> chat | chat_administrators
	Member map[int64]map[int64][]BotCommand  // chatID -> userID -> chat_member
}

// Resolve — список для участника без собственной записи chat_member:
// группа: chat_administrators(chat) [админ] → chat(chat) → all_chat_administrators
// [админ] → all_group_chats → default.
func (l BotGroupLists) Resolve(chatID int64, staff bool) []BotCommand {
	try := func(cs []BotCommand) bool { return len(cs) > 0 }
	if staff {
		if cs := l.Chat[chatID][BotScopeChatAdministrator]; try(cs) {
			return cs
		}
	}
	if cs := l.Chat[chatID][BotScopeChat]; try(cs) {
		return cs
	}
	if staff {
		if cs := l.Global[BotScopeAllChatAdmins]; try(cs) {
			return cs
		}
	}
	if cs := l.Global[BotScopeAllGroupChats]; try(cs) {
		return cs
	}
	return l.Global[BotScopeDefault]
}

// BotRecipient — участник чата бота, которому уходит updateBotCommands.
type BotRecipient struct {
	ChatID int64
	UserID int64
	Staff  bool // создатель или админ чата
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
