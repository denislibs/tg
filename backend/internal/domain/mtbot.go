package domain

// Витрины ботов: команды, кнопка-меню, inline-выдача и ответ callback-кнопки.
//
// Все четыре ехали безымянными объектами, хотя предмет у каждой в схеме есть —
// и совпадает с нашим по составу полей до буквы.

const (
	BotCommandTag             = "botCommand"
	BotMenuButtonTag          = "botMenuButton"
	BotInlineResultTag        = "botInlineResult"
	BotInlineMessageTextTag   = "botInlineMessageText"
	MessagesBotResultsTag     = "messages.botResults"
	MessagesBotCallbackAnsTag = "messages.botCallbackAnswer"
)

// botCommand#c27ac8c7 command:string description:string = BotCommand;
type MTBotCommand struct {
	Underscore  string `json:"_"`
	Command     string `json:"command"`
	Description string `json:"description"`
}

// NewBotCommand — строка списка команд бота.
func NewBotCommand(c BotCommand) MTBotCommand {
	return MTBotCommand{Underscore: BotCommandTag, Command: c.Command, Description: c.Description}
}

// botMenuButton#c7b57ce6 text:string url:string = BotMenuButton;
//
// Кнопка-меню mini-app. Объединение `BotMenuButton` в схеме шире (есть
// `botMenuButtonDefault` и `botMenuButtonCommands`), но производим мы одну
// форму: у нас кнопка либо задана парой «текст + адрес», либо её нет вовсе.
type BotMenuButton struct {
	Underscore string `json:"_"`
	Text       string `json:"text"`
	URL        string `json:"url"`
}

// NewBotMenuButton — кнопка-меню бота.
func NewBotMenuButton(text, url string) BotMenuButton {
	return BotMenuButton{Underscore: BotMenuButtonTag, Text: text, URL: url}
}

// botInlineMessageText#8c7f65e2 flags:# no_webpage:flags.0?true
// invert_media:flags.3?true message:string entities:flags.1?Vector<MessageEntity>
// reply_markup:flags.2?ReplyMarkup = BotInlineMessage;
//
// Что уйдёт в чат при выборе строки inline-выдачи.
type BotInlineMessageText struct {
	Underscore string `json:"_"`
	Message    string `json:"message"`
}

// botInlineResult#11965f3a flags:# id:string type:string title:flags.1?string
// description:flags.2?string url:flags.3?string thumb:flags.4?WebDocument
// content:flags.5?WebDocument send_message:BotInlineMessage = BotInlineResult;
//
// СТРОКА inline-выдачи. `type` у оригинала — вид результата (`article`,
// `photo`, `gif`…); у нас все строки текстовые, поэтому `article`.
//
// `emoji` — НАШ параметр (schema_additional_params.json): у оригинала иконку
// строки даёт `thumb:WebDocument`, то есть настоящий файл, а у нас её заменяет
// символ. Тот же приём, что `user.emoji_status_emoticon`.
type BotInlineResult struct {
	Underscore  string               `json:"_"`
	ID          string               `json:"id"`
	Type        string               `json:"type"`
	Title       string               `json:"title,omitempty"`
	Description string               `json:"description,omitempty"`
	Emoji       string               `json:"emoji,omitempty"`
	SendMessage BotInlineMessageText `json:"send_message"`
}

// NewBotInlineResult — строка inline-выдачи.
func NewBotInlineResult(r InlineResult) BotInlineResult {
	return BotInlineResult{
		Underscore:  BotInlineResultTag,
		ID:          r.ID,
		Type:        "article",
		Title:       r.Title,
		Description: r.Description,
		Emoji:       r.Emoji,
		SendMessage: BotInlineMessageText{Underscore: BotInlineMessageTextTag, Message: r.MessageText},
	}
}

// messages.botResults#e021f2f6 flags:# gallery:flags.0?true query_id:long
// next_offset:flags.1?string switch_pm:flags.2?InlineBotSwitchPM
// switch_webview:flags.3?InlineBotWebView results:Vector<BotInlineResult>
// cache_time:int users:Vector<User> = messages.BotResults;
//
// Контейнер inline-выдачи. Подсказка поля ввода (`placeholder`) рядом БОЛЬШЕ НЕ
// ЕДЕТ: у оригинала это параметр самого бота (`user.bot_inline_placeholder`), и
// карточка бота приезжает здесь же — вектором `users`.
//
// `query_id` у нас нулевой: выдача не кэшируется по номеру запроса, отправка
// строки идёт обычным сообщением. `cache_time` нулевой по той же причине.
type MessagesBotResults struct {
	Underscore string            `json:"_"`
	QueryID    int64             `json:"query_id"`
	Results    []BotInlineResult `json:"results"`
	CacheTime  int               `json:"cache_time"`
	Users      []UserReal        `json:"users"`
}

// NewMessagesBotResults — inline-выдача контейнером.
func NewMessagesBotResults(results []BotInlineResult, users []UserReal) MessagesBotResults {
	return MessagesBotResults{
		Underscore: MessagesBotResultsTag,
		Results:    orEmpty(results),
		Users:      orEmpty(users),
	}
}

// messages.botCallbackAnswer#36585ea4 flags:# alert:flags.1?true
// has_url:flags.3?true native_ui:flags.4?true message:flags.0?string
// url:flags.2?string cache_time:int = messages.BotCallbackAnswer;
//
// Ответ на нажатие callback-кнопки. «Показать плашкой, а не тостом» — ФЛАГ:
// прежде ехало булево поле `alert: false`, то есть «выключено» имело значение.
type MessagesBotCallbackAnswer struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Message    string          `json:"message,omitempty"`
	CacheTime  int             `json:"cache_time"`
}

// NewBotCallbackAnswer — всплывающий ответ бота.
func NewBotCallbackAnswer(text string, alert bool) MessagesBotCallbackAnswer {
	out := MessagesBotCallbackAnswer{Underscore: MessagesBotCallbackAnsTag, Message: text}
	setPFlag(&out.PFlags, "alert", alert)
	return out
}
