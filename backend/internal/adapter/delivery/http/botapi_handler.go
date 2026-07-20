package http

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// Bot API — Telegram-подобный HTTP-интерфейс для ботов-сервисов:
// /bot/{token}/{method}. Аутентификация — по токену в пути (без Bearer).
// Ответ — конверт {ok, result} / {ok:false, error_code, description}.
type BotAPIHandler struct{ svc *usecasechat.Interactor }

func NewBotAPIHandler(svc *usecasechat.Interactor) *BotAPIHandler { return &BotAPIHandler{svc: svc} }

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
func (b bodyParams) raw(key string) json.RawMessage { return b.body[key] }

type bodyParams struct {
	body  map[string]json.RawMessage
	query interface {
		Get(string) string
	}
}

func (h *BotAPIHandler) Handle(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	method := chi.URLParam(r, "method")
	bot, err := h.svc.BotAuth(r.Context(), token)
	if err != nil {
		botErr(w, http.StatusUnauthorized, "Unauthorized: bad token")
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
		var cmdsIn []struct {
			Command     string `json:"command"`
			Description string `json:"description"`
		}
		_ = json.Unmarshal(p.raw("commands"), &cmdsIn)
		cmds := make([]domain.BotCommand, 0, len(cmdsIn))
		for _, c := range cmdsIn {
			cmds = append(cmds, domain.BotCommand{Command: c.Command, Description: c.Description})
		}
		if err := h.svc.BotSetCommands(r.Context(), bot, cmds); err != nil {
			botErr(w, http.StatusInternalServerError, "setMyCommands failed")
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
		botOK(w, map[string]any{
			"message_id": msg.ID,
			"chat":       map[string]any{"id": chatID, "type": "private"},
			"text":       text,
		})
	case "answerCallbackQuery":
		var showAlert bool
		_ = json.Unmarshal(p.raw("show_alert"), &showAlert)
		h.svc.BotAnswerCallback(r.Context(), p.str("callback_query_id"), p.str("text"), showAlert)
		botOK(w, true)
	case "answerInlineQuery":
		h.svc.BotAnswerInline(r.Context(), p.str("inline_query_id"), parseInlineResults(p.raw("results")))
		botOK(w, true)
	default:
		botErr(w, http.StatusNotFound, "Method not found: "+method)
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
