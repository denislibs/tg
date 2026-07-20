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
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
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
