package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// Bot API — Telegram-подобный HTTP-интерфейс для ботов-сервисов:
// /bot/{token}/{method}. Аутентификация — по токену в пути (без Bearer).
// Ответ — конверт {ok, result} / {ok:false, error_code, description}.
type BotAPIHandler struct {
	svc     *usecasechat.Interactor
	media   *usecasemedia.Interactor // опционален: скачивание файлов (getFile)
	limiter *keyRateLimiter
}

func NewBotAPIHandler(svc *usecasechat.Interactor, media *usecasemedia.Interactor) *BotAPIHandler {
	return &BotAPIHandler{svc: svc, media: media, limiter: newKeyRateLimiter()}
}

func botOK(w http.ResponseWriter, result any) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result})
}
func botErr(w http.ResponseWriter, code int, desc string) {
	writeJSON(w, code, map[string]any{"ok": false, "error_code": code, "description": desc})
}

// decodeBody читает JSON-тело в m (для POST). Для GET параметры берутся из query.
func decodeBody(r *http.Request) map[string]json.RawMessage {
	m := map[string]json.RawMessage{}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&m)
	}
	return m
}

// param достаёт значение сначала из тела, затем из query (?k=).
func (b bodyParams) str(key string) string {
	if raw, ok := b.body[key]; ok {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
		return string(raw)
	}
	return b.query.Get(key)
}
func (b bodyParams) int(key string) int64 {
	if raw, ok := b.body[key]; ok {
		var n int64
		if json.Unmarshal(raw, &n) == nil {
			return n
		}
	}
	n, _ := strconv.ParseInt(b.query.Get(key), 10, 64)
	return n
}
func (b bodyParams) boolean(key string) bool {
	var v bool
	if raw, ok := b.body[key]; ok {
		_ = json.Unmarshal(raw, &v)
		return v
	}
	return b.query.Get(key) == "true"
}
func (b bodyParams) raw(key string) json.RawMessage { return b.body[key] }
func (b bodyParams) has(key string) bool {
	_, ok := b.body[key]
	return ok || b.query.Get(key) != ""
}

type bodyParams struct {
	body  map[string]json.RawMessage
	query interface {
		Get(string) string
	}
}

func (h *BotAPIHandler) Handle(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	method := chi.URLParam(r, "method")
	ip := clientIP(r)
	bot, err := h.svc.BotAuth(r.Context(), token)
	if err != nil {
		// Троттлим перебор токенов по IP, чтобы токен нельзя было брутфорсить.
		if !h.limiter.allow("badip:"+ip, 5, 10) {
			botErr(w, http.StatusTooManyRequests, "Too Many Requests")
			return
		}
		botErr(w, http.StatusUnauthorized, "Unauthorized: bad token")
		return
	}
	if !h.limiter.allow("bot:"+strconv.FormatInt(bot.BotID, 10), 30, 60) {
		botErr(w, http.StatusTooManyRequests, "Too Many Requests: retry later")
		return
	}
	p := bodyParams{body: decodeBody(r), query: r.URL.Query()}

	switch method {
	case "getMe":
		botOK(w, map[string]any{"id": bot.BotID, "is_bot": true, "first_name": bot.Name, "username": bot.Username})
	case "getUpdates":
		ups, err := h.svc.BotGetUpdates(r.Context(), bot, p.int("offset"), int(p.int("limit")), int(p.int("timeout")))
		if err != nil {
			botErr(w, http.StatusInternalServerError, "getUpdates failed")
			return
		}
		botOK(w, ups)
	case "setWebhook":
		if err := h.svc.BotSetWebhook(r.Context(), bot, p.str("url")); err != nil {
			botErr(w, http.StatusInternalServerError, "setWebhook failed")
			return
		}
		botOK(w, true)
	case "deleteWebhook":
		_ = h.svc.BotSetWebhook(r.Context(), bot, "")
		botOK(w, true)
	case "setMyCommands":
		scope, lang := parseCommandScope(p.raw("scope")), p.str("language_code")
		if err := h.svc.BotSetCommands(r.Context(), bot, scope, lang, parseCommands(p.raw("commands"))); err != nil {
			botErr(w, http.StatusInternalServerError, "setMyCommands failed")
			return
		}
		botOK(w, true)
	case "getMyCommands":
		cmds, err := h.svc.BotGetCommands(r.Context(), bot, parseCommandScope(p.raw("scope")), p.str("language_code"))
		if err != nil {
			botErr(w, http.StatusInternalServerError, "getMyCommands failed")
			return
		}
		out := make([]map[string]any, 0, len(cmds))
		for _, c := range cmds {
			out = append(out, map[string]any{"command": c.Command, "description": c.Description})
		}
		botOK(w, out)
	case "setMyDescription":
		desc := p.str("description")
		if err := h.svc.BotSetProfile(r.Context(), bot, &desc, nil); err != nil {
			botErr(w, http.StatusInternalServerError, "setMyDescription failed")
			return
		}
		botOK(w, true)
	case "setMyShortDescription":
		short := p.str("short_description")
		if err := h.svc.BotSetProfile(r.Context(), bot, nil, &short); err != nil {
			botErr(w, http.StatusInternalServerError, "setMyShortDescription failed")
			return
		}
		botOK(w, true)
	case "setChatMenuButton":
		text, url := parseMenuButton(p.raw("menu_button"))
		if err := h.svc.BotSetMenuButton(r.Context(), bot, text, url); err != nil {
			botErr(w, http.StatusInternalServerError, "setChatMenuButton failed")
			return
		}
		botOK(w, true)
	case "sendMessage":
		chatID := p.int("chat_id")
		text := p.str("text")
		if chatID == 0 || text == "" {
			botErr(w, http.StatusBadRequest, "chat_id and text required")
			return
		}
		markup := parseReplyMarkup(p.raw("reply_markup"))
		msg, err := h.svc.BotSendMessage(r.Context(), bot, chatID, text, markup)
		if err != nil {
			botErr(w, http.StatusBadRequest, "sendMessage failed: "+err.Error())
			return
		}
		botOK(w, botMessageResult(msg, chatID, text))
	case "sendPhoto", "sendDocument", "sendVideo":
		h.sendMedia(w, r, bot, p, method)
	case "editMessageText":
		chatID, msgID := p.int("chat_id"), p.int("message_id")
		text := p.str("text")
		if chatID == 0 || msgID == 0 || text == "" {
			botErr(w, http.StatusBadRequest, "chat_id, message_id and text required")
			return
		}
		hasMarkup := p.has("reply_markup")
		msg, err := h.svc.BotEditMessageText(r.Context(), bot, chatID, msgID, text,
			parseEntities(p.raw("entities")), parseReplyMarkup(p.raw("reply_markup")), hasMarkup)
		if err != nil {
			botErr(w, botErrCode(err), "editMessageText failed")
			return
		}
		botOK(w, botMessageResult(msg, chatID, text))
	case "editMessageReplyMarkup":
		chatID, msgID := p.int("chat_id"), p.int("message_id")
		if chatID == 0 || msgID == 0 {
			botErr(w, http.StatusBadRequest, "chat_id and message_id required")
			return
		}
		msg, err := h.svc.BotEditReplyMarkup(r.Context(), bot, chatID, msgID, parseReplyMarkup(p.raw("reply_markup")))
		if err != nil {
			botErr(w, botErrCode(err), "editMessageReplyMarkup failed")
			return
		}
		botOK(w, botMessageResult(msg, chatID, msg.Text))
	case "deleteMessage":
		chatID, msgID := p.int("chat_id"), p.int("message_id")
		if err := h.svc.BotDeleteMessage(r.Context(), bot, chatID, msgID); err != nil {
			botErr(w, botErrCode(err), "deleteMessage failed")
			return
		}
		botOK(w, true)
	case "getChat":
		res, err := h.svc.BotGetChat(r.Context(), bot, p.int("chat_id"))
		if err != nil {
			botErr(w, botErrCode(err), "getChat failed")
			return
		}
		botOK(w, res)
	case "getChatMember":
		res, err := h.svc.BotGetChatMember(r.Context(), bot, p.int("chat_id"), p.int("user_id"))
		if err != nil {
			botErr(w, botErrCode(err), "getChatMember failed")
			return
		}
		botOK(w, res)
	case "getFile":
		fileID := p.int("file_id")
		mediaID, err := h.svc.BotFileInfo(r.Context(), bot, fileID)
		if err != nil {
			botErr(w, botErrCode(err), "getFile failed")
			return
		}
		botOK(w, map[string]any{"file_id": mediaID, "file_path": strconv.FormatInt(mediaID, 10)})
	case "setChatPhoto", "setBotPhoto":
		if err := h.svc.BotSetPhotoURL(r.Context(), bot, p.str("photo")); err != nil {
			botErr(w, botErrCode(err), "setBotPhoto failed")
			return
		}
		botOK(w, true)
	case "answerCallbackQuery":
		h.svc.BotAnswerCallback(r.Context(), p.str("callback_query_id"), p.str("text"), p.boolean("show_alert"))
		botOK(w, true)
	case "answerInlineQuery":
		h.svc.BotAnswerInline(r.Context(), p.str("inline_query_id"), parseInlineResults(p.raw("results")))
		botOK(w, true)
	case "answerWebAppQuery":
		// Приняли ответ inline-webapp; сквозная доставка выбранного результата в
		// текущей версии идёт через web_app_data (sendData). Возвращаем ack.
		botOK(w, map[string]any{"inline_message_id": p.str("web_app_query_id")})
	default:
		botErr(w, http.StatusNotFound, "Method not found: "+method)
	}
}

// sendMedia — общий обработчик sendPhoto/sendDocument/sendVideo.
func (h *BotAPIHandler) sendMedia(w http.ResponseWriter, r *http.Request, bot domain.BotAccount, p bodyParams, method string) {
	var field, typ string
	switch method {
	case "sendPhoto":
		field, typ = "photo", "photo"
	case "sendVideo":
		field, typ = "video", "video"
	default:
		field, typ = "document", "document"
	}
	chatID := p.int("chat_id")
	fileRef := p.str(field)
	if chatID == 0 || fileRef == "" {
		botErr(w, http.StatusBadRequest, "chat_id and "+field+" required")
		return
	}
	msg, err := h.svc.BotSendMedia(r.Context(), bot, chatID, typ, fileRef,
		p.str("caption"), parseEntities(p.raw("caption_entities")), parseReplyMarkup(p.raw("reply_markup")), p.str("file_name"))
	if err != nil {
		botErr(w, botErrCode(err), method+" failed: "+err.Error())
		return
	}
	res := botMessageResult(msg, chatID, msg.Text)
	if msg.MediaID != nil {
		res[field] = map[string]any{"file_id": *msg.MediaID}
	}
	botOK(w, res)
}

// File — GET /file/bot/{token}/{fileID}: скачивание медиа бота (getFile → download).
func (h *BotAPIHandler) File(w http.ResponseWriter, r *http.Request) {
	if h.media == nil {
		botErr(w, http.StatusNotFound, "media disabled")
		return
	}
	bot, err := h.svc.BotAuth(r.Context(), chi.URLParam(r, "token"))
	if err != nil {
		botErr(w, http.StatusUnauthorized, "Unauthorized: bad token")
		return
	}
	mediaID, err := strconv.ParseInt(chi.URLParam(r, "fileID"), 10, 64)
	if err != nil {
		botErr(w, http.StatusBadRequest, "bad file id")
		return
	}
	if _, err := h.svc.BotFileInfo(r.Context(), bot, mediaID); err != nil {
		botErr(w, botErrCode(err), "forbidden")
		return
	}
	rc, info, _, err := h.media.GetContent(r.Context(), mediaID)
	if errors.Is(err, domain.ErrNotFound) {
		botErr(w, http.StatusNotFound, "file not found")
		return
	}
	if err != nil {
		botErr(w, http.StatusInternalServerError, "download failed")
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", info.ContentType)
	http.ServeContent(w, r, "", info.ModTime, rc)
}

func botMessageResult(msg domain.Message, chatID int64, text string) map[string]any {
	res := map[string]any{
		"message_id": msg.ID,
		"chat":       map[string]any{"id": chatID, "type": "private"},
		"text":       text,
	}
	// Разметка наружу — в плоской форме Bot API (см. botAPIEntities): ответ
	// метода должен читаться теми же клиентскими библиотеками, что и у Telegram.
	if ents := botAPIEntities(msg.Entities); len(ents) > 0 {
		res["entities"] = ents
	}
	if rm := botAPIReplyMarkup(msg.ReplyMarkup); rm != nil {
		res["reply_markup"] = rm
	}
	return res
}

func botErrCode(err error) int {
	switch {
	case errors.Is(err, domain.ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, domain.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, domain.ErrTooLong):
		return http.StatusBadRequest
	default:
		return http.StatusBadRequest
	}
}

// ── граница Bot API: разметка клавиатур ─────────────────────────────────────
//
// Публичный Bot API описывает клавиатуру своей ПЛОСКОЙ записью
// (inline_keyboard / keyboard / resize_keyboard / one_time_keyboard /
// callback_data / web_app) — это чужой контракт из документации Telegram, и
// менять его нельзя: ответ должны читать те же клиентские библиотеки, что и у
// настоящего Telegram. Ровно так устроен и оригинал: Bot API — фасад над
// MTProto. Поэтому здесь стоит конвертер в обе стороны, а модель внутри —
// объединение конструкторов схемы (domain/mtreplymarkup.go).
//
// То же решение уже принято для сущностей: parseEntities/botAPIEntities.

// botAPIKeyboardRow — ряд Bot API: массив кнопок. Тип общий для inline- и
// reply-клавиатуры, потому что таков контракт: у Telegram это InlineKeyboardButton
// и KeyboardButton с пересекающимся набором ключей.
type botAPIKeyboardRow []struct {
	Text         string                `json:"text"`
	CallbackData string                `json:"callback_data"`
	URL          string                `json:"url"`
	WebApp       *struct{ URL string } `json:"web_app"`
}

// parseReplyMarkup: Telegram InlineKeyboardMarkup / ReplyKeyboardMarkup /
// ReplyKeyboardRemove / ForceReply → объединение domain.ReplyMarkup.
func parseReplyMarkup(raw json.RawMessage) domain.ReplyMarkup {
	if len(raw) == 0 {
		return nil
	}
	var m struct {
		InlineKeyboard []botAPIKeyboardRow `json:"inline_keyboard"`
		// Ячейка reply-клавиатуры — объект KeyboardButton либо (легаси Bot API)
		// голая строка, поэтому RawMessage: разбор ниже принимает обе формы.
		Keyboard    [][]json.RawMessage `json:"keyboard"`
		Resize      bool                `json:"resize_keyboard"`
		OneTime     bool                `json:"one_time_keyboard"`
		Persistent  bool                `json:"is_persistent"`
		Selective   bool                `json:"selective"`
		Placeholder string              `json:"input_field_placeholder"`
		Remove      bool                `json:"remove_keyboard"`
		ForceReply  bool                `json:"force_reply"`
	}
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	switch {
	case m.Remove:
		return domain.NewReplyKeyboardHide(m.Selective)
	case m.ForceReply:
		return domain.NewReplyKeyboardForceReply(m.OneTime, m.Selective, m.Placeholder)
	case len(m.InlineKeyboard) > 0:
		rows := make([]domain.KeyboardButtonRow, 0, len(m.InlineKeyboard))
		for _, row := range m.InlineKeyboard {
			buttons := make([]domain.KeyboardButton, 0, len(row))
			for _, b := range row {
				// «Ровно один из» прежнего InlineButton стало выбором
				// конструктора: web_app важнее url (Telegram открывает mini-app),
				// а callback_data — последний, потому что кнопка без url и
				// web_app в Bot API всегда callback.
				switch {
				case b.WebApp != nil:
					buttons = append(buttons, domain.NewKeyboardButtonWebView(b.Text, b.WebApp.URL))
				case b.URL != "":
					buttons = append(buttons, domain.NewKeyboardButtonURL(b.Text, b.URL))
				default:
					// callback_data в Bot API — строка 1..64 байта; в схеме
					// data:bytes, поэтому байты её UTF-8 представления.
					buttons = append(buttons, domain.NewKeyboardButtonCallback(b.Text, []byte(b.CallbackData)))
				}
			}
			rows = append(rows, domain.NewKeyboardButtonRow(buttons...))
		}
		return domain.NewReplyInlineMarkup(rows)
	case m.Keyboard != nil:
		rows := make([]domain.KeyboardButtonRow, 0, len(m.Keyboard))
		for _, row := range m.Keyboard {
			buttons := make([]domain.KeyboardButton, 0, len(row))
			for _, cell := range row {
				buttons = append(buttons, domain.NewKeyboardButton(botAPIKeyboardCellText(cell)))
			}
			rows = append(rows, domain.NewKeyboardButtonRow(buttons...))
		}
		return domain.NewReplyKeyboardMarkup(rows, domain.ReplyKeyboardFlags{
			Resize: m.Resize, SingleUse: m.OneTime, Selective: m.Selective, Persistent: m.Persistent,
		}, m.Placeholder)
	}
	return nil
}

// botAPIKeyboardCellText достаёт текст ячейки reply-клавиатуры: объект
// KeyboardButton {"text":…} либо голая строка (легаси-форма Bot API).
func botAPIKeyboardCellText(cell json.RawMessage) string {
	var s string
	if json.Unmarshal(cell, &s) == nil {
		return s
	}
	var kb struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(cell, &kb)
	return kb.Text
}

// botAPIReplyMarkup — обратная сторона конвертера: объединение схемы → плоская
// запись Bot API. nil, если клавиатуры нет.
func botAPIReplyMarkup(markup domain.ReplyMarkup) map[string]any {
	switch m := markup.(type) {
	case domain.ReplyInlineMarkup:
		return map[string]any{"inline_keyboard": botAPIInlineRows(m.Rows)}
	case domain.ReplyKeyboardMarkup:
		out := map[string]any{"keyboard": botAPIKeyboardRows(m.Rows)}
		// Флаги Bot API — обычные булевы ключи, но «выключено» у него тоже
		// значит отсутствие: не кладём false, чтобы ответ совпадал с телеграмным.
		putIfTrue(out, "resize_keyboard", m.Resize())
		putIfTrue(out, "one_time_keyboard", m.SingleUse())
		putIfTrue(out, "is_persistent", m.Persistent())
		putIfTrue(out, "selective", m.Selective())
		if m.Placeholder != nil {
			out["input_field_placeholder"] = *m.Placeholder
		}
		return out
	case domain.ReplyKeyboardHide:
		out := map[string]any{"remove_keyboard": true}
		putIfTrue(out, "selective", m.Selective())
		return out
	case domain.ReplyKeyboardForceReply:
		out := map[string]any{"force_reply": true}
		putIfTrue(out, "one_time_keyboard", m.SingleUse())
		putIfTrue(out, "selective", m.Selective())
		if m.Placeholder != nil {
			out["input_field_placeholder"] = *m.Placeholder
		}
		return out
	}
	return nil
}

func putIfTrue(m map[string]any, key string, v bool) {
	if v {
		m[key] = true
	}
}

// botAPIInlineRows — ряды inline-клавиатуры в форме Bot API. Кнопка, чей
// конструктор в этой клавиатуре не встречается (keyboardButton), пропускается:
// плоской записи для неё в контракте Bot API нет.
func botAPIInlineRows(rows []domain.KeyboardButtonRow) [][]map[string]any {
	out := make([][]map[string]any, 0, len(rows))
	for _, row := range rows {
		cells := make([]map[string]any, 0, len(row.Buttons))
		for _, b := range row.Buttons {
			switch btn := b.(type) {
			case domain.KeyboardButtonCallback:
				cells = append(cells, map[string]any{"text": btn.Text, "callback_data": string(btn.Data)})
			case domain.KeyboardButtonURL:
				cells = append(cells, map[string]any{"text": btn.Text, "url": btn.URL})
			case domain.KeyboardButtonWebView:
				cells = append(cells, map[string]any{"text": btn.Text, "web_app": map[string]any{"url": btn.URL}})
			}
		}
		out = append(out, cells)
	}
	return out
}

// botAPIKeyboardRows — ряды reply-клавиатуры в форме Bot API (объекты
// KeyboardButton, а не легаси-строки: так их отдаёт Telegram).
func botAPIKeyboardRows(rows []domain.KeyboardButtonRow) [][]map[string]any {
	out := make([][]map[string]any, 0, len(rows))
	for _, row := range rows {
		cells := make([]map[string]any, 0, len(row.Buttons))
		for _, b := range row.Buttons {
			cells = append(cells, map[string]any{"text": b.Caption()})
		}
		out = append(out, cells)
	}
	return out
}

func parseMenuButton(raw json.RawMessage) (text, url string) {
	if len(raw) == 0 {
		return "", ""
	}
	var m struct {
		Type   string                `json:"type"`
		Text   string                `json:"text"`
		WebApp *struct{ URL string } `json:"web_app"`
	}
	if json.Unmarshal(raw, &m) != nil {
		return "", ""
	}
	if m.WebApp != nil {
		url = m.WebApp.URL
	}
	return m.Text, url
}

// parseInlineResults: Telegram InlineQueryResultArticle → domain.InlineResult.
func parseInlineResults(raw json.RawMessage) []domain.InlineResult {
	if len(raw) == 0 {
		return nil
	}
	var arr []struct {
		ID                  string `json:"id"`
		Title               string `json:"title"`
		Description         string `json:"description"`
		InputMessageContent struct {
			MessageText string `json:"message_text"`
		} `json:"input_message_content"`
	}
	if json.Unmarshal(raw, &arr) != nil {
		return nil
	}
	out := make([]domain.InlineResult, 0, len(arr))
	for _, a := range arr {
		out = append(out, domain.InlineResult{
			ID: a.ID, Title: a.Title, Description: a.Description, MessageText: a.InputMessageContent.MessageText,
		})
	}
	return out
}

// parseCommands: Telegram BotCommand[] → domain.BotCommand[].
func parseCommands(raw json.RawMessage) []domain.BotCommand {
	var cmdsIn []struct {
		Command     string `json:"command"`
		Description string `json:"description"`
	}
	_ = json.Unmarshal(raw, &cmdsIn)
	cmds := make([]domain.BotCommand, 0, len(cmdsIn))
	for _, c := range cmdsIn {
		cmds = append(cmds, domain.BotCommand{Command: c.Command, Description: c.Description})
	}
	return cmds
}

// parseCommandScope: {"type":"..."} → строка скоупа (пустая = default).
func parseCommandScope(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "default"
	}
	var s struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(raw, &s) != nil || s.Type == "" {
		return "default"
	}
	return s.Type
}

// ── Разметка на границе Bot API ─────────────────────────────────────────────
//
// Bot API — ФАСАД над нашей моделью, а не она сама. Публичный Bot API Telegram
// описывает разметку ПЛОСКОЙ записью
// {type:"bold", offset, length, url, language, user:{id}, custom_emoji_id} —
// это внешний контракт, зафиксированный чужой документацией, и совпадать с
// нашей внутренней моделью (объединение конструкторов схемы TL,
// domain/mtentity.go) он не обязан. Ровно так устроен и настоящий Telegram:
// Bot API — фасад над MTProto, и граница между ними — то самое место, где
// стоит конвертер.
//
// Поэтому здесь честный перевод в обе стороны, а наружу продолжает уходить
// плоская форма. Переводить публичный Bot API на конструкторы схемы нельзя:
// это сломало бы контракт у всех сторонних ботов.

// botAPIEntity — MessageEntity публичного Bot API (плоская запись).
type botAPIEntity struct {
	Type   string `json:"type"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
	URL    string `json:"url,omitempty"`
	// Language — подсказка языка у "pre". В нашей модели параметр
	// messageEntityPre.language обязателен и едет всегда (в т.ч. пустой), здесь
	// же его просто нет, когда подсказки не было, — это и есть разница контрактов.
	Language string      `json:"language,omitempty"`
	User     *botAPIUser `json:"user,omitempty"`
	// CustomEmojiID — в Bot API это СТРОКА (id документа), а не число.
	CustomEmojiID string `json:"custom_emoji_id,omitempty"`
}

type botAPIUser struct {
	ID int64 `json:"id"`
}

// parseEntities: MessageEntity[] Bot API → разметка в нашей модели.
//
// Типы Bot API, которых нет в нашем объединении (mention/hashtag/url/email/…),
// отбрасываются: это подсветка, которую клиент выводит из САМОГО текста, а не
// хранимая разметка (см. шапку domain/mtentity.go).
func parseEntities(raw json.RawMessage) domain.MessageEntities {
	if len(raw) == 0 {
		return nil
	}
	var arr []botAPIEntity
	if json.Unmarshal(raw, &arr) != nil {
		return nil
	}
	out := make(domain.MessageEntities, 0, len(arr))
	for _, e := range arr {
		var ent domain.MessageEntity
		switch e.Type {
		case "bold":
			ent = domain.NewMessageEntityBold(e.Offset, e.Length)
		case "italic":
			ent = domain.NewMessageEntityItalic(e.Offset, e.Length)
		case "underline":
			ent = domain.NewMessageEntityUnderline(e.Offset, e.Length)
		case "strikethrough":
			ent = domain.NewMessageEntityStrike(e.Offset, e.Length)
		case "code":
			ent = domain.NewMessageEntityCode(e.Offset, e.Length)
		case "pre":
			ent = domain.NewMessageEntityPre(e.Offset, e.Length, e.Language)
		case "spoiler":
			ent = domain.NewMessageEntitySpoiler(e.Offset, e.Length)
		case "blockquote":
			ent = domain.NewMessageEntityBlockquote(e.Offset, e.Length, false)
		case "expandable_blockquote":
			// Свёрнутая цитата: в Bot API это отдельный ТИП, в схеме — бит
			// messageEntityBlockquote.collapsed.
			ent = domain.NewMessageEntityBlockquote(e.Offset, e.Length, true)
		case "text_link":
			ent = domain.NewMessageEntityTextURL(e.Offset, e.Length, e.URL)
		case "text_mention":
			var userID int64
			if e.User != nil {
				userID = e.User.ID
			}
			ent = domain.NewMessageEntityMentionName(e.Offset, e.Length, userID)
		case "custom_emoji":
			docID, _ := strconv.ParseInt(e.CustomEmojiID, 10, 64)
			ent = domain.NewMessageEntityCustomEmoji(e.Offset, e.Length, docID)
		default:
			continue
		}
		out = append(out, ent)
	}
	return out
}

// botAPIEntities: разметка нашей модели → MessageEntity[] Bot API. Обратная
// сторона того же конвертера — наружу уходит плоская форма.
func botAPIEntities(es domain.MessageEntities) []botAPIEntity {
	if len(es) == 0 {
		return nil
	}
	out := make([]botAPIEntity, 0, len(es))
	for _, e := range es {
		offset, length := e.Span()
		be := botAPIEntity{Offset: offset, Length: length}
		switch v := e.(type) {
		case domain.MessageEntityBold:
			be.Type = "bold"
		case domain.MessageEntityItalic:
			be.Type = "italic"
		case domain.MessageEntityUnderline:
			be.Type = "underline"
		case domain.MessageEntityStrike:
			be.Type = "strikethrough"
		case domain.MessageEntityCode:
			be.Type = "code"
		case domain.MessageEntityPre:
			be.Type, be.Language = "pre", v.Language
		case domain.MessageEntitySpoiler:
			be.Type = "spoiler"
		case domain.MessageEntityBlockquote:
			be.Type = "blockquote"
			if v.Collapsed() {
				be.Type = "expandable_blockquote"
			}
		case domain.MessageEntityTextURL:
			be.Type, be.URL = "text_link", v.URL
		case domain.MessageEntityMentionName:
			be.Type, be.User = "text_mention", &botAPIUser{ID: v.UserID}
		case domain.MessageEntityCustomEmoji:
			be.Type, be.CustomEmojiID = "custom_emoji", strconv.FormatInt(v.DocumentID, 10)
		default:
			continue
		}
		out = append(out, be)
	}
	return out
}

// Лимитер вынесен в ratelimit.go (keyRateLimiter) — общий для бота и auth.
