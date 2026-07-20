package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// @BotFather — системный бот создания/управления ботами. Внутренний диалоговый
// мастер (не внешний сервис): состояние шага хранится в bot_wizard, ответы
// шлются как сообщения от BotFatherID. Флоу приближен к оригиналу Telegram.

var botUsernameRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$`)

func (i *Interactor) bfSend(ctx context.Context, chatID int64, text string, markup *domain.ReplyMarkup) {
	_, _ = i.Send(ctx, SendInput{ChatID: chatID, SenderID: domain.BotFatherID, Type: "text", Text: text, ReplyMarkup: markup})
}

// botFatherReply — главный обработчик сообщений пользователю @BotFather.
func (i *Interactor) botFatherReply(ctx context.Context, chatID, ownerID int64, text string) {
	text = strings.TrimSpace(text)
	w, _ := i.botAPI.WizardGet(ctx, ownerID)

	// /cancel работает всегда.
	if strings.EqualFold(text, "/cancel") {
		_ = i.botAPI.WizardClear(ctx, ownerID)
		i.bfSend(ctx, chatID, "Отменено.", nil)
		return
	}
	// При активном мастере ввод идёт в текущий шаг — так значения, начинающиеся
	// с «/» (например относительный URL /webapp-demo.html), не путаются с командой.
	if w.Flow != "" {
		i.bfStep(ctx, chatID, ownerID, w, text)
		return
	}
	if strings.HasPrefix(text, "/") {
		fields := strings.Fields(text)
		cmd := strings.ToLower(fields[0])
		arg := strings.TrimSpace(strings.TrimPrefix(text, fields[0]))
		i.bfCommand(ctx, chatID, ownerID, cmd, arg)
		return
	}
	i.bfSend(ctx, chatID, "Я @BotFather. Отправьте /newbot, чтобы создать бота, или /help — список команд.", nil)
}

func (i *Interactor) bfCommand(ctx context.Context, chatID, ownerID int64, cmd, arg string) {
	switch cmd {
	case "/start", "/help":
		i.bfSend(ctx, chatID, "Я помогу создавать и настраивать ботов.\n\n"+
			"/newbot — создать бота\n/mybots — мои боты и токены\n/token — показать токен\n"+
			"/revoke — пересоздать токен\n/setcommands — задать команды\n/newapp — создать mini-app\n"+
			"/setmenubutton — кнопка-меню mini-app\n/cancel — отменить", nil)
	case "/cancel":
		_ = i.botAPI.WizardClear(ctx, ownerID)
		i.bfSend(ctx, chatID, "Отменено.", nil)
	case "/newbot":
		i.bfSetWizard(ctx, ownerID, "newbot", "name", nil)
		i.bfSend(ctx, chatID, "Как назовём бота? Пришлите отображаемое имя.", nil)
	case "/mybots":
		i.bfListBots(ctx, chatID, ownerID)
	case "/token":
		i.bfStartWhich(ctx, chatID, ownerID, "token", arg)
	case "/revoke":
		i.bfStartWhich(ctx, chatID, ownerID, "revoke", arg)
	case "/setcommands":
		i.bfStartWhich(ctx, chatID, ownerID, "setcommands", arg)
	case "/newapp":
		i.bfStartWhich(ctx, chatID, ownerID, "newapp", arg)
	case "/setmenubutton":
		i.bfStartWhich(ctx, chatID, ownerID, "setmenubutton", arg)
	default:
		i.bfSend(ctx, chatID, "Неизвестная команда. /help — список.", nil)
	}
}

// bfStartWhich начинает флоу, требующий выбора бота: если у владельца один бот —
// берём его; если несколько — просим @username; если нет — предлагаем /newbot.
func (i *Interactor) bfStartWhich(ctx context.Context, chatID, ownerID int64, flow, arg string) {
	bots, _ := i.botAPI.BotsByOwner(ctx, ownerID)
	if len(bots) == 0 {
		i.bfSend(ctx, chatID, "У вас пока нет ботов. Создайте бота: /newbot", nil)
		return
	}
	var target *domain.BotAccount
	if arg != "" {
		uname := strings.TrimPrefix(arg, "@")
		for idx := range bots {
			if strings.EqualFold(bots[idx].Username, uname) {
				target = &bots[idx]
				break
			}
		}
	} else if len(bots) == 1 {
		target = &bots[0]
	}
	if target == nil {
		list := make([]string, len(bots))
		for idx, b := range bots {
			list[idx] = "@" + b.Username
		}
		i.bfSetWizard(ctx, ownerID, flow, "which", nil)
		i.bfSend(ctx, chatID, "Выберите бота — пришлите его @username:\n"+strings.Join(list, "\n"), nil)
		return
	}
	i.bfAfterWhich(ctx, chatID, ownerID, flow, *target)
}

// bfAfterWhich — бот выбран, продолжаем конкретный флоу.
func (i *Interactor) bfAfterWhich(ctx context.Context, chatID, ownerID int64, flow string, bot domain.BotAccount) {
	switch flow {
	case "token":
		_ = i.botAPI.WizardClear(ctx, ownerID)
		i.bfSend(ctx, chatID, fmt.Sprintf("Токен бота @%s:\n%s", bot.Username, bot.Token), nil)
	case "revoke":
		newTok, err := i.botAPI.RegenToken(ctx, bot.BotID)
		_ = i.botAPI.WizardClear(ctx, ownerID)
		if err != nil {
			i.bfSend(ctx, chatID, "Не удалось пересоздать токен.", nil)
			return
		}
		i.bfSend(ctx, chatID, fmt.Sprintf("Старый токен @%s отозван. Новый токен:\n%s", bot.Username, newTok), nil)
	case "setcommands":
		i.bfSetWizard(ctx, ownerID, "setcommands", "commands", map[string]string{"bot": fmt.Sprint(bot.BotID)})
		i.bfSend(ctx, chatID, "Пришлите список команд, по одной в строке в формате:\ncommand - описание\nНапример:\nstart - запустить\nhelp - помощь", nil)
	case "newapp":
		i.bfSetWizard(ctx, ownerID, "newapp", "title", map[string]string{"bot": fmt.Sprint(bot.BotID)})
		i.bfSend(ctx, chatID, "Создаём mini-app для @"+bot.Username+".\nПришлите название приложения.", nil)
	case "setmenubutton":
		i.bfSetWizard(ctx, ownerID, "setmenubutton", "text", map[string]string{"bot": fmt.Sprint(bot.BotID)})
		i.bfSend(ctx, chatID, "Пришлите текст кнопки-меню (например «Открыть»).", nil)
	}
}

// bfStep — обработка ввода на шаге активного мастера.
func (i *Interactor) bfStep(ctx context.Context, chatID, ownerID int64, w domain.BotWizard, text string) {
	data := map[string]string{}
	_ = json.Unmarshal(w.Data, &data)
	if data == nil { // JSON "null" обнуляет map — восстанавливаем
		data = map[string]string{}
	}

	// Шаг выбора бота (общий для нескольких флоу).
	if w.Step == "which" {
		bots, _ := i.botAPI.BotsByOwner(ctx, ownerID)
		uname := strings.TrimPrefix(strings.TrimSpace(text), "@")
		for _, b := range bots {
			if strings.EqualFold(b.Username, uname) {
				i.bfAfterWhich(ctx, chatID, ownerID, w.Flow, b)
				return
			}
		}
		i.bfSend(ctx, chatID, "Не нашёл такого бота среди ваших. Пришлите корректный @username или /cancel.", nil)
		return
	}

	switch w.Flow {
	case "newbot":
		i.bfStepNewbot(ctx, chatID, ownerID, w.Step, data, text)
	case "setcommands":
		i.bfStepSetCommands(ctx, chatID, ownerID, data, text)
	case "newapp":
		i.bfStepNewApp(ctx, chatID, ownerID, w.Step, data, text)
	case "setmenubutton":
		i.bfStepMenuButton(ctx, chatID, ownerID, w.Step, data, text)
	}
}

func (i *Interactor) bfStepNewbot(ctx context.Context, chatID, ownerID int64, step string, data map[string]string, text string) {
	switch step {
	case "name":
		if text == "" {
			i.bfSend(ctx, chatID, "Имя не может быть пустым. Пришлите имя бота.", nil)
			return
		}
		data["name"] = text
		i.bfSetWizard(ctx, ownerID, "newbot", "username", data)
		i.bfSend(ctx, chatID, "Отлично. Теперь придумайте username для бота — латиницей, должен заканчиваться на «bot» (например my_demo_bot).", nil)
	case "username":
		uname := strings.TrimPrefix(strings.TrimSpace(text), "@")
		if !botUsernameRe.MatchString(uname) || !strings.HasSuffix(strings.ToLower(uname), "bot") {
			i.bfSend(ctx, chatID, "Username должен быть 5–32 символа, латиница/цифры/подчёркивание и заканчиваться на «bot». Попробуйте ещё раз.", nil)
			return
		}
		taken, _ := i.botAPI.UsernameTaken(ctx, uname)
		if taken {
			i.bfSend(ctx, chatID, "Этот username уже занят. Придумайте другой.", nil)
			return
		}
		bot, err := i.botAPI.CreateBot(ctx, ownerID, data["name"], uname)
		_ = i.botAPI.WizardClear(ctx, ownerID)
		if err != nil {
			i.bfSend(ctx, chatID, "Не удалось создать бота. Попробуйте позже.", nil)
			return
		}
		i.bfSend(ctx, chatID, fmt.Sprintf(
			"Готово! Поздравляю с новым ботом. Он доступен как @%s.\n\nТокен для Bot API:\n%s\n\n"+
				"Держите токен в секрете. Дальше: /setcommands, /newapp, /setmenubutton.",
			bot.Username, bot.Token), nil)
	}
}

func (i *Interactor) bfStepSetCommands(ctx context.Context, chatID, ownerID int64, data map[string]string, text string) {
	botID := parseInt64(data["bot"])
	var cmds []domain.BotCommand
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "-", 2)
		cmd := strings.TrimSpace(strings.TrimPrefix(parts[0], "/"))
		desc := ""
		if len(parts) == 2 {
			desc = strings.TrimSpace(parts[1])
		}
		if cmd != "" {
			cmds = append(cmds, domain.BotCommand{Command: cmd, Description: desc})
		}
	}
	_ = i.botAPI.WizardClear(ctx, ownerID)
	if len(cmds) == 0 {
		i.bfSend(ctx, chatID, "Не разобрал ни одной команды. Формат: «command - описание».", nil)
		return
	}
	if err := i.botAPI.SetCommands(ctx, botID, cmds); err != nil {
		i.bfSend(ctx, chatID, "Не удалось сохранить команды.", nil)
		return
	}
	i.bfSend(ctx, chatID, fmt.Sprintf("Готово! Обновил список команд (%d).", len(cmds)), nil)
}

func (i *Interactor) bfStepNewApp(ctx context.Context, chatID, ownerID int64, step string, data map[string]string, text string) {
	switch step {
	case "title":
		data["title"] = text
		i.bfSetWizard(ctx, ownerID, "newapp", "shortname", data)
		i.bfSend(ctx, chatID, "Пришлите короткое имя приложения (латиницей, для ссылки).", nil)
	case "shortname":
		short := strings.TrimSpace(text)
		if short == "" {
			i.bfSend(ctx, chatID, "Короткое имя не может быть пустым.", nil)
			return
		}
		data["short"] = short
		i.bfSetWizard(ctx, ownerID, "newapp", "url", data)
		i.bfSend(ctx, chatID, "Пришлите URL приложения (https://…).", nil)
	case "url":
		url := strings.TrimSpace(text)
		botID := parseInt64(data["bot"])
		if err := i.botAPI.CreateApp(ctx, domain.BotApp{BotID: botID, ShortName: data["short"], Title: data["title"], URL: url}); err != nil {
			_ = i.botAPI.WizardClear(ctx, ownerID)
			i.bfSend(ctx, chatID, "Не удалось создать mini-app.", nil)
			return
		}
		_ = i.botAPI.WizardClear(ctx, ownerID)
		bot, _ := i.botAPI.BotByID(ctx, botID)
		i.bfSend(ctx, chatID, fmt.Sprintf("Готово! Mini-app «%s» создан.\nПрямая ссылка: t.me/%s/%s", data["title"], bot.Username, data["short"]), nil)
	}
}

func (i *Interactor) bfStepMenuButton(ctx context.Context, chatID, ownerID int64, step string, data map[string]string, text string) {
	switch step {
	case "text":
		data["text"] = strings.TrimSpace(text)
		i.bfSetWizard(ctx, ownerID, "setmenubutton", "url", data)
		i.bfSend(ctx, chatID, "Пришлите URL mini-app для кнопки-меню (https://…).", nil)
	case "url":
		botID := parseInt64(data["bot"])
		if err := i.botAPI.SetMenuButton(ctx, botID, data["text"], strings.TrimSpace(text)); err != nil {
			_ = i.botAPI.WizardClear(ctx, ownerID)
			i.bfSend(ctx, chatID, "Не удалось задать кнопку-меню.", nil)
			return
		}
		_ = i.botAPI.WizardClear(ctx, ownerID)
		i.bfSend(ctx, chatID, "Готово! Кнопка-меню обновлена — она откроет mini-app у пользователей бота.", nil)
	}
}

func (i *Interactor) bfListBots(ctx context.Context, chatID, ownerID int64) {
	bots, _ := i.botAPI.BotsByOwner(ctx, ownerID)
	if len(bots) == 0 {
		i.bfSend(ctx, chatID, "У вас пока нет ботов. Создайте: /newbot", nil)
		return
	}
	lines := make([]string, len(bots))
	for idx, b := range bots {
		lines[idx] = fmt.Sprintf("• @%s — %s", b.Username, b.Name)
	}
	i.bfSend(ctx, chatID, "Ваши боты:\n"+strings.Join(lines, "\n")+"\n\n/token — токен, /setcommands — команды, /newapp — mini-app.", nil)
}

func (i *Interactor) bfSetWizard(ctx context.Context, ownerID int64, flow, step string, data map[string]string) {
	raw, _ := json.Marshal(data)
	_ = i.botAPI.WizardSet(ctx, domain.BotWizard{UserID: ownerID, Flow: flow, Step: step, Data: raw})
}

func parseInt64(s string) int64 {
	var v int64
	_, _ = fmt.Sscan(s, &v)
	return v
}
