package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

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
	limiter *botRateLimiter
}

func NewBotAPIHandler(svc *usecasechat.Interactor, media *usecasemedia.Interactor) *BotAPIHandler {
	return &BotAPIHandler{svc: svc, media: media, limiter: newBotRateLimiter()}
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
	return map[string]any{
		"message_id": msg.ID,
		"chat":       map[string]any{"id": chatID, "type": "private"},
		"text":       text,
	}
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

// parseReplyMarkup: Telegram InlineKeyboardMarkup / ReplyKeyboardMarkup /
// ReplyKeyboardRemove → domain.ReplyMarkup.
func parseReplyMarkup(raw json.RawMessage) *domain.ReplyMarkup {
	if len(raw) == 0 {
		return nil
	}
	var m struct {
		InlineKeyboard [][]struct {
			Text         string                `json:"text"`
			CallbackData string                `json:"callback_data"`
			URL          string                `json:"url"`
			WebApp       *struct{ URL string } `json:"web_app"`
		} `json:"inline_keyboard"`
		Keyboard [][]json.RawMessage `json:"keyboard"`
		Resize   bool                `json:"resize_keyboard"`
		OneTime  bool                `json:"one_time_keyboard"`
		Remove   bool                `json:"remove_keyboard"`
	}
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	out := &domain.ReplyMarkup{Resize: m.Resize, OneTime: m.OneTime}
	if m.Remove {
		out.Keyboard = [][]string{} // пустая клавиатура = скрыть
		return out
	}
	for _, row := range m.InlineKeyboard {
		r := make([]domain.InlineButton, 0, len(row))
		for _, b := range row {
			btn := domain.InlineButton{Text: b.Text, Callback: b.CallbackData, URL: b.URL}
			if b.WebApp != nil {
				btn.WebApp = b.WebApp.URL
			}
			r = append(r, btn)
		}
		out.Inline = append(out.Inline, r)
	}
	for _, row := range m.Keyboard {
		r := make([]string, 0, len(row))
		for _, cell := range row {
			var s string
			if json.Unmarshal(cell, &s) == nil {
				r = append(r, s)
				continue
			}
			var kb struct{ Text string }
			_ = json.Unmarshal(cell, &kb)
			r = append(r, kb.Text)
		}
		out.Keyboard = append(out.Keyboard, r)
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

// parseEntities: Telegram MessageEntity[] → domain.MessageEntity[] (типы совпадают).
func parseEntities(raw json.RawMessage) []domain.MessageEntity {
	if len(raw) == 0 {
		return nil
	}
	var arr []struct {
		Type     string `json:"type"`
		Offset   int    `json:"offset"`
		Length   int    `json:"length"`
		URL      string `json:"url"`
		Language string `json:"language"`
		User     *struct {
			ID int64 `json:"id"`
		} `json:"user"`
	}
	if json.Unmarshal(raw, &arr) != nil {
		return nil
	}
	out := make([]domain.MessageEntity, 0, len(arr))
	for _, e := range arr {
		ent := domain.MessageEntity{Type: e.Type, Offset: e.Offset, Length: e.Length, URL: e.URL, Lang: e.Language}
		if e.User != nil {
			ent.UserID = e.User.ID
		}
		out = append(out, ent)
	}
	return out
}

// ── rate limiter (token bucket на ключ) ──

type botRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket
}
type tokenBucket struct {
	tokens float64
	last   time.Time
}

func newBotRateLimiter() *botRateLimiter {
	return &botRateLimiter{buckets: map[string]*tokenBucket{}}
}

// allow пропускает запрос по ключу с заданной скоростью (rps) и «ведром» (burst).
func (l *botRateLimiter) allow(key string, rps, burst float64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b := l.buckets[key]
	if b == nil {
		b = &tokenBucket{tokens: burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * rps
	if b.tokens > burst {
		b.tokens = burst
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}
