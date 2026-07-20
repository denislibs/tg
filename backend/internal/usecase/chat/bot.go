package chat

import (
	"context"
	"fmt"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// Боты. Реальных ботов нет — есть один демо-бот (@demobot), чьё поведение зашито
// здесь: авто-ответы на сообщения в приватном чате с ним (эхо, /start, кнопки),
// ответы на нажатия callback-кнопок, список команд. Всё остальное (несколько
// ботов, MTProto) отсутствует — это демонстрация механики inline/reply-клавиатур.

// maybeBotReply: сообщение ушло в приватный чат боту — маршрутизируем.
//   - бот с учёткой Bot API → апдейт в очередь (+ webhook), отвечает внешний сервис;
//   - @BotFather → внутренний диалоговый мастер;
//   - иначе (демо-бот) → зашитый авто-ответ.
func (i *Interactor) maybeBotReply(ctx context.Context, chatID, senderID, msgID int64, text string) {
	if i.bots == nil {
		return
	}
	botID, ok := i.privateBotPeer(ctx, chatID, senderID)
	if !ok {
		return
	}
	if i.botAPI != nil {
		if bot, err := i.botAPI.BotByID(ctx, botID); err == nil {
			i.dispatchMessageUpdate(ctx, bot, chatID, senderID, msgID, text)
			return
		}
		if botID == domain.BotFatherID {
			i.botFatherReply(ctx, chatID, senderID, text)
			return
		}
	}
	reply, markup := demoBotReply(text)
	if reply == "" {
		return
	}
	_, _ = i.Send(ctx, SendInput{ChatID: chatID, SenderID: botID, Type: "text", Text: reply, ReplyMarkup: markup})
}

// privateBotPeer возвращает id второго участника приватного чата, если он бот.
func (i *Interactor) privateBotPeer(ctx context.Context, chatID, senderID int64) (int64, bool) {
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil || len(members) != 2 {
		return 0, false // не приватный диалог из двух участников
	}
	other := members[0]
	if other == senderID {
		other = members[1]
	}
	if other == senderID {
		return 0, false // self-chat
	}
	isBot, err := i.bots.IsBot(ctx, other)
	if err != nil || !isBot {
		return 0, false
	}
	return other, true
}

// BotCommands — список команд бота (для popup по «/» и меню).
func (i *Interactor) BotCommands(ctx context.Context, botID int64) ([]domain.BotCommand, error) {
	if i.bots == nil {
		return nil, domain.ErrNotFound
	}
	return i.bots.Commands(ctx, botID)
}

// BotCallback обрабатывает нажатие callback-кнопки: возвращает всплывающий
// ответ (toast/alert) и, для некоторых кнопок, шлёт новое сообщение бота.
func (i *Interactor) BotCallback(ctx context.Context, chatID, userID, botID, msgID int64, data string) (domain.BotCallbackAnswer, error) {
	if i.bots == nil {
		return domain.BotCallbackAnswer{}, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil || !ok {
		return domain.BotCallbackAnswer{}, domain.ErrForbidden
	}
	isBot, err := i.bots.IsBot(ctx, botID)
	if err != nil || !isBot {
		return domain.BotCallbackAnswer{}, domain.ErrNotFound
	}
	// Реальный бот-сервис → callback уходит апдейтом, ждём answerCallbackQuery.
	if i.botAPI != nil {
		if bot, err := i.botAPI.BotByID(ctx, botID); err == nil {
			return i.botCallbackViaAPI(ctx, bot, chatID, userID, msgID, data), nil
		}
	}
	switch data {
	case "alert":
		return domain.BotCallbackAnswer{Text: "Это alert-попап! 🎉", Alert: true}, nil
	case "more":
		_, _ = i.Send(ctx, SendInput{ChatID: chatID, SenderID: botID, Type: "text",
			Text: "Ещё одно сообщение от бота 🤖"})
		return domain.BotCallbackAnswer{Text: "Отправил ещё одно"}, nil
	case "echo":
		return domain.BotCallbackAnswer{Text: "Кнопка нажата 🙂"}, nil
	default:
		return domain.BotCallbackAnswer{Text: data}, nil
	}
}

// InlineQuery — выдача inline-режима (@bot query). Проверяет, что botID — бот,
// затем зашитый сценарий демо-бота (реального движка ботов нет).
func (i *Interactor) InlineQuery(ctx context.Context, viewerID, botID int64, query string) ([]domain.InlineResult, error) {
	if i.bots == nil {
		return nil, domain.ErrNotFound
	}
	isBot, err := i.bots.IsBot(ctx, botID)
	if err != nil || !isBot {
		return nil, domain.ErrNotFound
	}
	// Реальный бот-сервис → inline-запрос уходит апдейтом, ждём answerInlineQuery.
	// Inline должен быть включён (/setinline), иначе — пустая выдача (как в TG).
	if i.botAPI != nil {
		if bot, err := i.botAPI.BotByID(ctx, botID); err == nil {
			if !bot.InlineEnabled {
				return []domain.InlineResult{}, nil
			}
			return i.botInlineViaAPI(ctx, bot, viewerID, query), nil
		}
	}
	return demoBotInline(query), nil
}

// demoBotInline — inline-выдача демо-бота. Пустой запрос → примеры; иначе
// несколько трансформаций введённого текста (эхо/капс/жирный) как «результаты».
func demoBotInline(query string) []domain.InlineResult {
	q := strings.TrimSpace(query)
	if q == "" {
		return []domain.InlineResult{
			{ID: "hello", Emoji: "👋", Title: "Поздороваться", Description: "Отправить приветствие", MessageText: "Привет! 👋"},
			{ID: "dice", Emoji: "🎲", Title: "Бросить кубик", Description: "Случайное настроение", MessageText: "🎲"},
			{ID: "about", Emoji: "🤖", Title: "О демо-боте", Description: "Что это за бот", MessageText: "Это демо-бот мессенджера — показывает inline-режим и mini-apps."},
		}
	}
	return []domain.InlineResult{
		{ID: "echo", Emoji: "✏️", Title: q, Description: "Отправить как есть", MessageText: q},
		{ID: "upper", Emoji: "🔠", Title: strings.ToUpper(q), Description: "ЗАГЛАВНЫМИ БУКВАМИ", MessageText: strings.ToUpper(q)},
		{ID: "hearts", Emoji: "❤️", Title: "❤️ " + q + " ❤️", Description: "С сердечками", MessageText: "❤️ " + q + " ❤️"},
	}
}

// webAppURL — адрес демо mini-app (статика фронта, раздаётся тем же nginx).
const webAppURL = "/webapp-demo.html"

// demoBotReply — сценарий демо-бота: текст ответа + клавиатура.
func demoBotReply(text string) (string, *domain.ReplyMarkup) {
	switch strings.TrimSpace(strings.ToLower(text)) {
	case "/start":
		return "Привет! Я демо-бот 🤖. Вот что я умею:", &domain.ReplyMarkup{
			Inline: [][]domain.InlineButton{
				{{Text: "Показать alert", Callback: "alert"}, {Text: "Сайт Telegram", URL: "https://telegram.org"}},
				{{Text: "🚀 Открыть mini-app", WebApp: webAppURL}},
				{{Text: "Ещё сообщение", Callback: "more"}},
			},
		}
	case "/app":
		return "Нажмите кнопку, чтобы открыть mini-app 👇", &domain.ReplyMarkup{
			Inline: [][]domain.InlineButton{{{Text: "🚀 Открыть mini-app", WebApp: webAppURL}}},
		}
	case "/inline":
		return "Inline-режим: в любом чате напишите «@demobot запрос» и выберите результат из списка — он отправится в чат.", nil
	case "/help":
		return "Команды:\n/start — запустить\n/buttons — inline-кнопки\n/keyboard — клавиатура\n/hide — скрыть клавиатуру\n/app — открыть mini-app\n/inline — про inline-режим", nil
	case "/buttons":
		return "Выберите кнопку:", &domain.ReplyMarkup{
			Inline: [][]domain.InlineButton{
				{{Text: "🔔 Alert", Callback: "alert"}, {Text: "🔁 Эхо", Callback: "echo"}},
				{{Text: "🌐 Открыть сайт", URL: "https://telegram.org"}},
			},
		}
	case "/keyboard":
		return "Клавиатура снизу 👇", &domain.ReplyMarkup{
			Keyboard: [][]string{{"Кнопка A", "Кнопка B"}, {"/hide"}},
			Resize:   true,
		}
	case "/hide":
		return "Клавиатура скрыта.", &domain.ReplyMarkup{Keyboard: [][]string{}}
	default:
		return fmt.Sprintf("Вы написали: «%s»", text), &domain.ReplyMarkup{
			Inline: [][]domain.InlineButton{{{Text: "🔁 Повторить", Callback: "echo"}}},
		}
	}
}
