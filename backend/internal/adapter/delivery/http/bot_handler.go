package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
)

// Боты: список команд + нажатие callback-кнопки. Хендлеры на ChatHandler.

// BotCommands — GET /bots/{botID}/commands.
func (h *ChatHandler) BotCommands(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	cmds, err := h.svc.BotCommands(r.Context(), botID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "bots disabled")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load commands")
		return
	}
	if cmds == nil {
		cmds = []domain.BotCommand{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"commands": cmds})
}

// BotInline — GET /bots/{botID}/inline?q=...: выдача inline-режима (@bot query).
func (h *ChatHandler) BotInline(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	results, err := h.svc.InlineQuery(r.Context(), h.meID(r), botID, r.URL.Query().Get("q"))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not a bot")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "inline failed")
		return
	}
	if results == nil {
		results = []domain.InlineResult{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"results":     results,
		"placeholder": h.svc.BotInlinePlaceholder(r.Context(), botID),
	})
}

// BotMenuButton — GET /bots/{botID}/menu_button: кнопка-меню mini-app бота.
func (h *ChatHandler) BotMenuButton(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	text, url := h.svc.BotMenuButton(r.Context(), botID)
	writeJSON(w, http.StatusOK, map[string]any{"text": text, "url": url})
}

// BotCallback — POST /bots/{botID}/callback {chat_id, data}: нажатие
// callback-кнопки; возвращает всплывающий ответ (toast/alert).
func (h *ChatHandler) BotCallback(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	var b struct {
		ChatID    int64  `json:"chat_id"`
		MessageID int64  `json:"message_id"`
		Data      string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.ChatID <= 0 {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	ans, err := h.svc.BotCallback(r.Context(), b.ChatID, h.meID(r), botID, b.MessageID, b.Data)
	if errors.Is(err, domain.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not a member")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not a bot")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "callback failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"text": ans.Text, "alert": ans.Alert})
}

// BotStart — POST /bots/{botID}/start {payload}: deep link t.me/<bot>?start=<payload>.
// Открывает приватный чат и шлёт «/start [payload]» от лица пользователя.
func (h *ChatHandler) BotStart(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	var b struct {
		Payload string `json:"payload"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	chatID, err := h.svc.BotStart(r.Context(), h.meID(r), botID, b.Payload)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not a bot")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "start failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chat_id": chatID})
}

// BotWebAppData — POST /bots/{botID}/webapp_data {data, button_text}: sendData
// из mini-app доставляется боту-владельцу апдейтом web_app_data.
func (h *ChatHandler) BotWebAppData(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	var b struct {
		Data       string `json:"data"`
		ButtonText string `json:"button_text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.BotWebAppData(r.Context(), h.meID(r), botID, b.Data, b.ButtonText); err != nil {
		writeError(w, http.StatusInternalServerError, "webapp_data failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// BotCloudGet — POST /bots/{botID}/cloud/get {keys}: чтение CloudStorage mini-app.
func (h *ChatHandler) BotCloudGet(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	var b struct {
		Keys []string `json:"keys"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	vals, err := h.svc.BotCloudGet(r.Context(), botID, h.meID(r), b.Keys)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cloud get failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": vals})
}

// BotCloudSet — POST /bots/{botID}/cloud/set {key, value}.
func (h *ChatHandler) BotCloudSet(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	var b struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.svc.BotCloudSet(r.Context(), botID, h.meID(r), b.Key, b.Value); err != nil {
		if errors.Is(err, domain.ErrForbidden) || errors.Is(err, domain.ErrTooLong) {
			writeError(w, http.StatusBadRequest, "invalid key/value or quota exceeded")
			return
		}
		writeError(w, http.StatusInternalServerError, "cloud set failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// BotCloudRemove — POST /bots/{botID}/cloud/remove {keys}.
func (h *ChatHandler) BotCloudRemove(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	var b struct {
		Keys []string `json:"keys"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := h.svc.BotCloudRemove(r.Context(), botID, h.meID(r), b.Keys); err != nil {
		writeError(w, http.StatusInternalServerError, "cloud remove failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// BotCloudKeys — GET /bots/{botID}/cloud/keys.
func (h *ChatHandler) BotCloudKeys(w http.ResponseWriter, r *http.Request) {
	botID, ok := pathInt(w, r, "botID")
	if !ok {
		return
	}
	keys, err := h.svc.BotCloudKeys(r.Context(), botID, h.meID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cloud keys failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
}
