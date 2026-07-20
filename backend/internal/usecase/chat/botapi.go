package chat

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Bot API — движок ботов-сервисов: пользователь пишет боту → апдейт кладётся в
// очередь (getUpdates) и/или POST'ится на webhook; бот отвечает методами
// sendMessage/answerCallbackQuery/answerInlineQuery. callback/inline —
// синхронный запрос от клиента, который ждёт ответа бота через pending-хаб.

const botAnswerTimeout = 6 * time.Second

// botPendingHub — незавершённые callback/inline запросы, ждущие ответа бота.
type botPendingHub struct {
	mu  sync.Mutex
	cb  map[string]chan domain.BotCallbackAnswer
	inl map[string]chan []domain.InlineResult
}

func newBotHub() *botPendingHub {
	return &botPendingHub{cb: map[string]chan domain.BotCallbackAnswer{}, inl: map[string]chan []domain.InlineResult{}}
}

func randID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (i *Interactor) hub() *botPendingHub {
	if i.botHub == nil {
		i.botHub = newBotHub()
	}
	return i.botHub
}

// ── генерация апдейтов ──

func (i *Interactor) userBrief(ctx context.Context, id int64) map[string]any {
	username, name, err := i.botAPI.UserBrief(ctx, id)
	if err != nil {
		return map[string]any{"id": id, "is_bot": false}
	}
	m := map[string]any{"id": id, "is_bot": false, "first_name": name}
	if username != "" {
		m["username"] = username
	}
	return m
}

// dispatchBotUpdate кладёт апдейт в очередь и, если задан webhook, POST'ит его.
func (i *Interactor) dispatchBotUpdate(ctx context.Context, bot domain.BotAccount, inner map[string]any) {
	payload, err := json.Marshal(inner)
	if err != nil {
		return
	}
	updateID, err := i.botAPI.EnqueueUpdate(ctx, bot.BotID, payload)
	if err != nil {
		return
	}
	if bot.WebhookURL != "" {
		full := map[string]any{"update_id": updateID}
		for k, v := range inner {
			full[k] = v
		}
		body, _ := json.Marshal(full)
		go postWebhook(bot.WebhookURL, body)
	}
}

func postWebhook(url string, body []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
}

// dispatchMessageUpdate — пользователь написал боту.
func (i *Interactor) dispatchMessageUpdate(ctx context.Context, bot domain.BotAccount, chatID, fromID, msgID int64, text string) {
	i.dispatchBotUpdate(ctx, bot, map[string]any{
		"message": map[string]any{
			"message_id": msgID,
			"from":       i.userBrief(ctx, fromID),
			"chat":       map[string]any{"id": chatID, "type": "private"},
			"date":       time.Now().Unix(),
			"text":       text,
		},
	})
}

// dispatchCallbackQuery — пользователь нажал callback-кнопку у бота; ждём ответа
// (answerCallbackQuery) до таймаута. Возвращает всплывающий ответ.
func (i *Interactor) botCallbackViaAPI(ctx context.Context, bot domain.BotAccount, chatID, fromID, msgID int64, data string) domain.BotCallbackAnswer {
	id := randID()
	ch := make(chan domain.BotCallbackAnswer, 1)
	h := i.hub()
	h.mu.Lock()
	h.cb[id] = ch
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.cb, id); h.mu.Unlock() }()

	msg := map[string]any{"chat": map[string]any{"id": chatID, "type": "private"}}
	if msgID > 0 {
		msg["message_id"] = msgID
	}
	i.dispatchBotUpdate(ctx, bot, map[string]any{
		"callback_query": map[string]any{
			"id": id, "from": i.userBrief(ctx, fromID), "message": msg, "data": data,
		},
	})
	select {
	case ans := <-ch:
		return ans
	case <-time.After(botAnswerTimeout):
		return domain.BotCallbackAnswer{}
	case <-ctx.Done():
		return domain.BotCallbackAnswer{}
	}
}

// botInlineViaAPI — inline-запрос к боту-сервису; ждём answerInlineQuery.
func (i *Interactor) botInlineViaAPI(ctx context.Context, bot domain.BotAccount, fromID int64, query string) []domain.InlineResult {
	id := randID()
	ch := make(chan []domain.InlineResult, 1)
	h := i.hub()
	h.mu.Lock()
	h.inl[id] = ch
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.inl, id); h.mu.Unlock() }()

	i.dispatchBotUpdate(ctx, bot, map[string]any{
		"inline_query": map[string]any{
			"id": id, "from": i.userBrief(ctx, fromID), "query": query, "offset": "",
		},
	})
	select {
	case res := <-ch:
		return res
	case <-time.After(botAnswerTimeout):
		return nil
	case <-ctx.Done():
		return nil
	}
}

// BotAnswerCallback — ответ бота на callback: доставляем ждущему клиенту.
func (i *Interactor) BotAnswerCallback(_ context.Context, id, text string, alert bool) {
	h := i.hub()
	h.mu.Lock()
	ch := h.cb[id]
	h.mu.Unlock()
	if ch != nil {
		select {
		case ch <- domain.BotCallbackAnswer{Text: text, Alert: alert}:
		default:
		}
	}
}

// BotAnswerInline — ответ бота на inline-запрос: доставляем ждущему клиенту.
func (i *Interactor) BotAnswerInline(_ context.Context, id string, results []domain.InlineResult) {
	h := i.hub()
	h.mu.Lock()
	ch := h.inl[id]
	h.mu.Unlock()
	if ch != nil {
		select {
		case ch <- results:
		default:
		}
	}
}

// ── методы Bot API ──

// BotAuth резолвит бота по токену.
func (i *Interactor) BotAuth(ctx context.Context, token string) (domain.BotAccount, error) {
	if i.botAPI == nil {
		return domain.BotAccount{}, domain.ErrNotFound
	}
	return i.botAPI.BotByToken(ctx, token)
}

// BotGetUpdates — long-poll: подтверждает offset и отдаёт новые апдейты
// (с инжектированным update_id). timeout — сколько ждать первого апдейта.
func (i *Interactor) BotGetUpdates(ctx context.Context, bot domain.BotAccount, offset int64, limit, timeoutSec int) ([]json.RawMessage, error) {
	deadline := time.Now().Add(time.Duration(clampInt(timeoutSec, 0, 30)) * time.Second)
	for {
		ups, err := i.botAPI.PullUpdates(ctx, bot.BotID, offset, limit)
		if err != nil {
			return nil, err
		}
		if len(ups) > 0 || time.Now().After(deadline) {
			out := make([]json.RawMessage, 0, len(ups))
			for _, u := range ups {
				var m map[string]any
				if json.Unmarshal(u.Payload, &m) != nil {
					continue
				}
				m["update_id"] = u.UpdateID
				b, _ := json.Marshal(m)
				out = append(out, b)
			}
			return out, nil
		}
		select {
		case <-ctx.Done():
			return []json.RawMessage{}, nil
		case <-time.After(400 * time.Millisecond):
		}
	}
}

// BotSendMessage — бот шлёт сообщение в чат (должен быть его участником).
func (i *Interactor) BotSendMessage(ctx context.Context, bot domain.BotAccount, chatID int64, text string, markup *domain.ReplyMarkup) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, chatID, bot.BotID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrForbidden
	}
	return i.Send(ctx, SendInput{ChatID: chatID, SenderID: bot.BotID, Type: "text", Text: text, ReplyMarkup: markup})
}

// BotSetWebhook / BotDeleteWebhook.
func (i *Interactor) BotSetWebhook(ctx context.Context, bot domain.BotAccount, url string) error {
	return i.botAPI.SetWebhook(ctx, bot.BotID, url)
}

// BotSetCommands задаёт список команд бота.
func (i *Interactor) BotSetCommands(ctx context.Context, bot domain.BotAccount, cmds []domain.BotCommand) error {
	return i.botAPI.SetCommands(ctx, bot.BotID, cmds)
}

// BotSetMenuButton задаёт кнопку-меню mini-app бота.
func (i *Interactor) BotSetMenuButton(ctx context.Context, bot domain.BotAccount, text, url string) error {
	return i.botAPI.SetMenuButton(ctx, bot.BotID, text, url)
}

// BotMenuButton — кнопка-меню mini-app бота для клиента (пусто — не задана).
func (i *Interactor) BotMenuButton(ctx context.Context, botID int64) (text, url string) {
	if i.botAPI == nil {
		return "", ""
	}
	bot, err := i.botAPI.BotByID(ctx, botID)
	if err != nil {
		return "", ""
	}
	return bot.MenuButtonText, bot.MenuButtonURL
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
