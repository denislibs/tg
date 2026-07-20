package domain

import "encoding/json"

// BotFatherID — системный бот @BotFather (создание/управление ботами). Его
// логика зашита в usecase (не внешний сервис), как и у демо-бота.
const BotFatherID int64 = 424241

// BotAccount — учётка бота-сервиса: владелец, токен, webhook и кнопка-меню.
// Сам бот — это пользователь (users.is_bot=true); здесь — «серверная» часть.
type BotAccount struct {
	BotID          int64
	OwnerID        int64
	Token          string
	WebhookURL     string
	MenuButtonText string
	MenuButtonURL  string
	// Гидрируется join'ом с users (для getMe / списков).
	Username string
	Name     string
}

// BotApp — именованный mini-app бота (BotFather /newapp), открывается по
// прямой ссылке / кнопке-меню.
type BotApp struct {
	BotID     int64
	ShortName string
	Title     string
	URL       string
}

// BotUpdate — элемент очереди апдейтов бота (getUpdates). Payload — уже готовый
// Telegram-подобный Update (message/callback_query/inline_query) в JSON.
type BotUpdate struct {
	UpdateID int64
	Payload  json.RawMessage
}

// BotWizard — состояние диалогового мастера BotFather для пользователя.
type BotWizard struct {
	UserID int64
	Flow   string          // newbot | newapp | setcommands | setmenubutton | ""
	Step   string          // текущий шаг флоу
	Data   json.RawMessage // накопленные поля (имя/username/…)
}
