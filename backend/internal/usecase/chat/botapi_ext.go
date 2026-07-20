package chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Расширенные методы Bot API: правка/удаление сообщений, медиа, чтение чата,
// профиль/inline-настройки, CloudStorage mini-app, web_app_data и deep-link старт.

const maxBotMedia = 20 << 20 // 20 MiB на файл, загружаемый ботом по URL

// ── редактирование/удаление сообщений ──

// BotEditMessageText меняет текст (и, если задано, клавиатуру) сообщения бота.
func (i *Interactor) BotEditMessageText(ctx context.Context, bot domain.BotAccount, chatID, msgID int64, text string, entities []domain.MessageEntity, markup *domain.ReplyMarkup, setMarkup bool) (domain.Message, error) {
	if utf8.RuneCountInString(text) > maxMessageRunes {
		return domain.Message{}, domain.ErrTooLong
	}
	return i.botEditMessage(ctx, bot, chatID, msgID, &text, sanitizeEntities(entities), markup, setMarkup)
}

// BotEditReplyMarkup меняет только клавиатуру сообщения бота (markup=nil — убрать).
func (i *Interactor) BotEditReplyMarkup(ctx context.Context, bot domain.BotAccount, chatID, msgID int64, markup *domain.ReplyMarkup) (domain.Message, error) {
	return i.botEditMessage(ctx, bot, chatID, msgID, nil, nil, markup, true)
}

func (i *Interactor) botEditMessage(ctx context.Context, bot domain.BotAccount, chatID, msgID int64, text *string, entities []domain.MessageEntity, markup *domain.ReplyMarkup, setMarkup bool) (domain.Message, error) {
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return domain.Message{}, err
	}
	if cur.ChatID != chatID || cur.Deleted {
		return domain.Message{}, domain.ErrNotFound
	}
	if cur.SenderID != bot.BotID {
		return domain.Message{}, domain.ErrForbidden // бот правит только свои сообщения
	}
	msg := cur
	var members []int64
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if text != nil {
			m, e := i.msgs.UpdateText(ctx, msgID, *text, entities)
			if e != nil {
				return e
			}
			msg = m
		}
		if setMarkup {
			m, e := i.msgs.UpdateReplyMarkup(ctx, msgID, markup)
			if e != nil {
				return e
			}
			msg = m
		}
		mem, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		payload, e := json.Marshal(editUpdatePayload(msg))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "edit_message", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return domain.Message{}, err
	}
	if i.publisher != nil {
		f := frame("edit_message", editUpdatePayload(msg))
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return msg, nil
}

// BotDeleteMessage удаляет сообщение бота у всех (revoke).
func (i *Interactor) BotDeleteMessage(ctx context.Context, bot domain.BotAccount, chatID, msgID int64) error {
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if cur.ChatID != chatID {
		return domain.ErrNotFound
	}
	if cur.SenderID != bot.BotID {
		return domain.ErrForbidden
	}
	return i.DeleteMessage(ctx, chatID, msgID, bot.BotID, true)
}

// ── медиа ──

// BotSendMedia отправляет фото/видео/документ. fileRef — URL (скачиваем и кладём
// в хранилище от имени бота) или числовой file_id (переиспользуем медиа бота).
func (i *Interactor) BotSendMedia(ctx context.Context, bot domain.BotAccount, chatID int64, msgType, fileRef, caption string, entities []domain.MessageEntity, markup *domain.ReplyMarkup, fileName string) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, chatID, bot.BotID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrForbidden
	}
	var mediaID int64
	if id, e := strconv.ParseInt(strings.TrimSpace(fileRef), 10, 64); e == nil && id > 0 {
		// file_id: переиспользуем ранее загруженное ботом медиа.
		owner, err := i.mediaAccess.OwnerID(ctx, id)
		if err != nil {
			return domain.Message{}, err
		}
		if owner != bot.BotID {
			return domain.Message{}, domain.ErrForbidden
		}
		mediaID = id
	} else {
		if i.botMedia == nil {
			return domain.Message{}, domain.ErrNotFound // медиа отключено (нет MinIO)
		}
		data, mime, err := fetchBotMedia(fileRef)
		if err != nil {
			return domain.Message{}, err
		}
		if fileName == "" {
			fileName = path.Base(fileRef)
		}
		mediaID, err = i.botMedia.Store(ctx, bot.BotID, mime, fileName, data)
		if err != nil {
			return domain.Message{}, err
		}
	}
	return i.Send(ctx, SendInput{
		ChatID: chatID, SenderID: bot.BotID, Type: msgType,
		Text: caption, Entities: entities, MediaID: &mediaID, ReplyMarkup: markup,
	})
}

// fetchBotMedia скачивает файл по URL с лимитом размера; mime берётся из
// заголовка ответа либо определяется по содержимому.
func fetchBotMedia(url string) ([]byte, string, error) {
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return nil, "", domain.ErrForbidden
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", domain.ErrNotFound
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBotMedia+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > maxBotMedia {
		return nil, "", domain.ErrTooLong
	}
	mime := resp.Header.Get("Content-Type")
	if idx := strings.IndexByte(mime, ';'); idx >= 0 {
		mime = strings.TrimSpace(mime[:idx])
	}
	if mime == "" || mime == "application/octet-stream" {
		mime = http.DetectContentType(data)
	}
	return data, mime, nil
}

// BotFileInfo — getFile: путь для скачивания медиа бота (file_path = media_id).
func (i *Interactor) BotFileInfo(ctx context.Context, bot domain.BotAccount, mediaID int64) (int64, error) {
	owner, err := i.mediaAccess.OwnerID(ctx, mediaID)
	if err != nil {
		return 0, err
	}
	if owner != bot.BotID {
		// бот может скачивать и медиа из чатов, где он состоит
		ok, err := i.mediaAccess.CanAccess(ctx, bot.BotID, mediaID)
		if err != nil || !ok {
			return 0, domain.ErrForbidden
		}
	}
	return mediaID, nil
}

// ── чтение чата ──

// BotGetChat — getChat: минимальное представление чата для бота.
func (i *Interactor) BotGetChat(ctx context.Context, bot domain.BotAccount, chatID int64) (map[string]any, error) {
	ok, err := i.chats.IsMember(ctx, chatID, bot.BotID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrForbidden
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"id": chatID, "type": typ}
	if typ == "private" {
		peer := i.otherMember(ctx, chatID, bot.BotID)
		if peer != 0 {
			username, name, _ := i.botAPI.UserBrief(ctx, peer)
			out["first_name"] = name
			if username != "" {
				out["username"] = username
			}
		}
		return out, nil
	}
	if i.groups != nil {
		if card, e := i.groups.Card(ctx, chatID, bot.BotID); e == nil {
			out["title"] = card.Title
			if card.Username != "" {
				out["username"] = card.Username
			}
			if card.About != "" {
				out["description"] = card.About
			}
		}
	}
	return out, nil
}

// BotGetChatMember — getChatMember: статус пользователя в чате.
func (i *Interactor) BotGetChatMember(ctx context.Context, bot domain.BotAccount, chatID, userID int64) (map[string]any, error) {
	ok, err := i.chats.IsMember(ctx, chatID, bot.BotID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrForbidden
	}
	username, name, _ := i.botAPI.UserBrief(ctx, userID)
	user := map[string]any{"id": userID, "is_bot": false, "first_name": name}
	if username != "" {
		user["username"] = username
	}
	status := "left"
	if i.groups != nil {
		if m, e := i.groups.GetMember(ctx, chatID, userID); e == nil {
			status = memberStatus(m.Role)
		}
	}
	if status == "left" {
		if isMem, _ := i.chats.IsMember(ctx, chatID, userID); isMem {
			status = "member"
		}
	}
	return map[string]any{"user": user, "status": status}, nil
}

func memberStatus(role string) string {
	switch role {
	case domain.RoleCreator:
		return "creator"
	case domain.RoleAdmin:
		return "administrator"
	case domain.RoleMember, domain.RoleSubscriber:
		return "member"
	default:
		return "member"
	}
}

func (i *Interactor) otherMember(ctx context.Context, chatID, self int64) int64 {
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return 0
	}
	for _, m := range members {
		if m != self {
			return m
		}
	}
	return 0
}

// ── профиль / inline ──

func (i *Interactor) BotSetProfile(ctx context.Context, bot domain.BotAccount, description, about *string) error {
	return i.botAPI.SetProfile(ctx, bot.BotID, description, about)
}
func (i *Interactor) BotSetInline(ctx context.Context, bot domain.BotAccount, enabled bool, placeholder string) error {
	return i.botAPI.SetInline(ctx, bot.BotID, enabled, placeholder)
}

// BotSetPhotoURL задаёт аватар бота из картинки по URL (/setuserpic).
func (i *Interactor) BotSetPhotoURL(ctx context.Context, bot domain.BotAccount, url string) error {
	if i.botMedia == nil {
		return domain.ErrNotFound // медиа отключено (нет MinIO)
	}
	data, mime, err := fetchBotMedia(url)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(mime, "image/") {
		return domain.ErrForbidden
	}
	mediaID, err := i.botMedia.Store(ctx, bot.BotID, mime, path.Base(url), data)
	if err != nil {
		return err
	}
	return i.botAPI.SetAvatar(ctx, bot.BotID, mediaID)
}

// BotInlinePlaceholder — плейсхолдер поля ввода для inline-режима бота (может
// быть пустым). Для внутренних ботов (демо) — пусто.
func (i *Interactor) BotInlinePlaceholder(ctx context.Context, botID int64) string {
	if i.botAPI == nil {
		return ""
	}
	bot, err := i.botAPI.BotByID(ctx, botID)
	if err != nil {
		return ""
	}
	return bot.InlinePlaceholder
}

// ── CloudStorage mini-app ──

func (i *Interactor) BotCloudGet(ctx context.Context, botID, userID int64, keys []string) (map[string]string, error) {
	if i.botAPI == nil {
		return map[string]string{}, nil
	}
	return i.botAPI.CloudGet(ctx, botID, userID, keys)
}
func (i *Interactor) BotCloudSet(ctx context.Context, botID, userID int64, key, value string) error {
	if i.botAPI == nil {
		return domain.ErrNotFound
	}
	if key == "" || len(key) > 128 || len(value) > 4096 {
		return domain.ErrForbidden
	}
	return i.botAPI.CloudSet(ctx, botID, userID, key, value)
}
func (i *Interactor) BotCloudRemove(ctx context.Context, botID, userID int64, keys []string) error {
	if i.botAPI == nil {
		return nil
	}
	return i.botAPI.CloudRemove(ctx, botID, userID, keys)
}
func (i *Interactor) BotCloudKeys(ctx context.Context, botID, userID int64) ([]string, error) {
	if i.botAPI == nil {
		return []string{}, nil
	}
	return i.botAPI.CloudKeys(ctx, botID, userID)
}

// ── web_app_data (sendData из mini-app доходит до бота-владельца) ──

// BotWebAppData доставляет данные из mini-app боту-владельцу как апдейт message
// с полем web_app_data (Telegram web_app_data для keyboard/menu-button apps).
func (i *Interactor) BotWebAppData(ctx context.Context, viewerID, botID int64, data, buttonText string) error {
	if i.botAPI == nil {
		return nil
	}
	bot, err := i.botAPI.BotByID(ctx, botID)
	if err != nil {
		return nil // демо/BotFather: данных боту нет, клиент уже показал тост
	}
	chatID, err := i.chats.FindPrivate(ctx, viewerID, botID)
	if err != nil {
		return err
	}
	i.dispatchBotUpdate(ctx, bot, map[string]any{
		"message": map[string]any{
			"from": i.userBrief(ctx, viewerID),
			"chat": map[string]any{"id": chatID, "type": "private"},
			"date": time.Now().Unix(),
			"web_app_data": map[string]any{
				"data":        data,
				"button_text": buttonText,
			},
		},
	})
	return nil
}

// ── deep link: t.me/<bot>?start=<payload> ──

// BotStart открывает приватный чат с ботом и шлёт «/start [payload]» от лица
// пользователя — бот получает это обычным message-апдейтом.
func (i *Interactor) BotStart(ctx context.Context, viewerID, botID int64, payload string) (int64, error) {
	if i.bots == nil {
		return 0, domain.ErrNotFound
	}
	isBot, err := i.bots.IsBot(ctx, botID)
	if err != nil || !isBot {
		return 0, domain.ErrNotFound
	}
	chatID, err := i.CreatePrivateChat(ctx, viewerID, botID)
	if err != nil {
		return 0, err
	}
	text := "/start"
	if payload = strings.TrimSpace(payload); payload != "" {
		text += " " + payload
	}
	if _, err := i.Send(ctx, SendInput{ChatID: chatID, SenderID: viewerID, Type: "text", Text: text}); err != nil {
		return 0, err
	}
	return chatID, nil
}
