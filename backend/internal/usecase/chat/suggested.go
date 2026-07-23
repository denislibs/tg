package chat

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Предложка постов в каналах (Telegram suggested posts): участник без права
// постинга предлагает пост (текст+медиа, опц. желаемое время публикации). Пост
// попадает в очередь предложки со статусом pending; админ канала одобряет
// (публикует сразу или к назначенному времени обычным каналным сообщением) либо
// отклоняет. Автор узнаёт о решении сервисным сообщением; списки предложек живут
// фреймом suggested_post_update (админам — новые/решённые, автору — статус его
// предложки).

// SuggestPost кладёт предложенный пост в очередь канала (status=pending) и
// уведомляет админов. Предлагать может участник канала БЕЗ права постинга — у
// кого право есть, тот постит напрямую.
func (i *Interactor) SuggestPost(ctx context.Context, chatID, authorID int64, text string, entities []domain.MessageEntity, mediaID *int64, publishAt *time.Time) (domain.SuggestedPostInfo, error) {
	if i.suggested == nil {
		return domain.SuggestedPostInfo{}, domain.ErrNotFound
	}
	if err := i.requireChannel(ctx, chatID); err != nil {
		return domain.SuggestedPostInfo{}, err
	}
	ok, err := i.chats.IsMember(ctx, chatID, authorID)
	if err != nil {
		return domain.SuggestedPostInfo{}, err
	}
	if !ok {
		return domain.SuggestedPostInfo{}, domain.ErrForbidden
	}
	// Право постинга ⇒ публикуй напрямую, предложка не нужна.
	if i.requireRight(ctx, chatID, authorID, domain.RightPostMessages) == nil {
		return domain.SuggestedPostInfo{}, domain.ErrForbidden
	}
	text = strings.TrimSpace(text)
	if text == "" && mediaID == nil {
		return domain.SuggestedPostInfo{}, domain.ErrInvalid
	}
	if utf8.RuneCountInString(text) > maxMessageRunes {
		return domain.SuggestedPostInfo{}, domain.ErrTooLong
	}
	// Медиа должно принадлежать автору (как в Send).
	if mediaID != nil {
		owner, e := i.mediaAccess.OwnerID(ctx, *mediaID)
		if e != nil {
			return domain.SuggestedPostInfo{}, e
		}
		if owner != authorID {
			return domain.SuggestedPostInfo{}, domain.ErrForbidden
		}
	}
	if publishAt != nil && !publishAt.After(time.Now()) {
		publishAt = nil // прошедшее время — публиковать как можно скорее
	}
	sp, err := i.suggested.Create(ctx, domain.SuggestedPost{
		ChatID: chatID, AuthorID: authorID, Text: text,
		Entities: sanitizeEntities(entities), MediaID: mediaID,
		PublishAt: publishAt, Status: "pending",
	})
	if err != nil {
		return domain.SuggestedPostInfo{}, err
	}
	info := i.suggestedPostInfo(ctx, sp)
	i.publishSuggestedToAdmins(ctx, chatID, info)
	return info, nil
}

// ListSuggestedPosts — предложенные посты канала: админ (право постинга) видит все
// ожидающие, обычный участник — только свои (любой статус).
func (i *Interactor) ListSuggestedPosts(ctx context.Context, chatID, viewerID int64) ([]domain.SuggestedPostInfo, error) {
	if i.suggested == nil {
		return nil, domain.ErrNotFound
	}
	if err := i.requireChannel(ctx, chatID); err != nil {
		return nil, err
	}
	var rows []domain.SuggestedPost
	var err error
	if i.requireRight(ctx, chatID, viewerID, domain.RightPostMessages) == nil {
		rows, err = i.suggested.ListPending(ctx, chatID)
	} else {
		ok, e := i.chats.IsMember(ctx, chatID, viewerID)
		if e != nil {
			return nil, e
		}
		if !ok {
			return nil, domain.ErrForbidden
		}
		rows, err = i.suggested.ListByAuthor(ctx, chatID, viewerID)
	}
	if err != nil {
		return nil, err
	}
	out := make([]domain.SuggestedPostInfo, 0, len(rows))
	for _, sp := range rows {
		out = append(out, i.suggestedPostInfo(ctx, sp))
	}
	return out, nil
}

// ApproveSuggestedPost одобряет предложенный пост (только админ с правом постинга):
// публикует его в канал сразу либо, если задано будущее время, помечает к
// отложенной публикации (её выполнит воркер DispatchDueSuggestedPosts). publishAt
// админа приоритетнее желаемого автором; nil — публиковать сейчас.
func (i *Interactor) ApproveSuggestedPost(ctx context.Context, id, adminID int64, publishAt *time.Time) (domain.SuggestedPostInfo, error) {
	if i.suggested == nil {
		return domain.SuggestedPostInfo{}, domain.ErrNotFound
	}
	sp, err := i.suggested.ByID(ctx, id)
	if err != nil {
		return domain.SuggestedPostInfo{}, err
	}
	if err := i.requireRight(ctx, sp.ChatID, adminID, domain.RightPostMessages); err != nil {
		return domain.SuggestedPostInfo{}, err
	}
	if sp.Status != "pending" {
		return domain.SuggestedPostInfo{}, domain.ErrInvalid
	}
	when := publishAt
	if when == nil {
		when = sp.PublishAt
	}
	if when != nil && !when.After(time.Now()) {
		when = nil
	}
	decided, err := i.suggested.Decide(ctx, id, "approved", adminID, when)
	if err != nil {
		return domain.SuggestedPostInfo{}, err
	}
	// Немедленная публикация — тут же обычным каналным сообщением. Отложенную
	// (when != nil) опубликует воркер по наступлении времени.
	if when == nil {
		if _, e := i.publishApprovedPost(ctx, decided, adminID); e != nil {
			return domain.SuggestedPostInfo{}, e
		}
	}
	info := i.suggestedPostInfo(ctx, decided)
	i.notifyAuthorDecision(ctx, decided, true)
	i.publishSuggestedToAdmins(ctx, decided.ChatID, info)
	i.publishSuggestedToAuthor(ctx, decided.AuthorID, info)
	return info, nil
}

// RejectSuggestedPost отклоняет предложенный пост (только админ с правом постинга)
// и уведомляет автора.
func (i *Interactor) RejectSuggestedPost(ctx context.Context, id, adminID int64) (domain.SuggestedPostInfo, error) {
	if i.suggested == nil {
		return domain.SuggestedPostInfo{}, domain.ErrNotFound
	}
	sp, err := i.suggested.ByID(ctx, id)
	if err != nil {
		return domain.SuggestedPostInfo{}, err
	}
	if err := i.requireRight(ctx, sp.ChatID, adminID, domain.RightPostMessages); err != nil {
		return domain.SuggestedPostInfo{}, err
	}
	if sp.Status != "pending" {
		return domain.SuggestedPostInfo{}, domain.ErrInvalid
	}
	decided, err := i.suggested.Decide(ctx, id, "rejected", adminID, nil)
	if err != nil {
		return domain.SuggestedPostInfo{}, err
	}
	info := i.suggestedPostInfo(ctx, decided)
	i.notifyAuthorDecision(ctx, decided, false)
	i.publishSuggestedToAdmins(ctx, decided.ChatID, info)
	i.publishSuggestedToAuthor(ctx, decided.AuthorID, info)
	return info, nil
}

// DispatchDueSuggestedPosts публикует одобренные посты с наступившим временем
// публикации (фоновый воркер, тот же тикер что и scheduled). Возвращает число
// опубликованных.
func (i *Interactor) DispatchDueSuggestedPosts(ctx context.Context) (int, error) {
	if i.suggested == nil {
		return 0, nil
	}
	due, err := i.suggested.DuePublish(ctx, time.Now(), 50)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, sp := range due {
		actor := sp.AuthorID
		if sp.DecidedBy != nil {
			actor = *sp.DecidedBy
		}
		if _, e := i.publishApprovedPost(ctx, sp, actor); e != nil {
			continue
		}
		// publish_at=NULL: пост опубликован, воркер его больше не подхватит.
		_ = i.suggested.MarkPublished(ctx, sp.ID)
		n++
	}
	return n, nil
}

// publishApprovedPost публикует одобренный пост обычным каналным сообщением
// (bump channel_pts + channel_update + PublishToChannel, как PostToChannel), с
// текстом/сущностями/медиа предложки. actorID — тот, от чьего имени публикуем.
func (i *Interactor) publishApprovedPost(ctx context.Context, sp domain.SuggestedPost, actorID int64) (domain.Message, error) {
	msgType := "text"
	if sp.MediaID != nil {
		msgType = i.channelMediaType(ctx, *sp.MediaID)
	}
	var msg domain.Message
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		seq, e := i.msgs.NextSeq(ctx, sp.ChatID)
		if e != nil {
			return e
		}
		m, e := i.msgs.Insert(ctx, domain.Message{
			ChatID: sp.ChatID, Seq: seq, SenderID: actorID,
			Type: msgType, Text: sp.Text, Entities: sp.Entities, MediaID: sp.MediaID,
		})
		if e != nil {
			return e
		}
		msg = m
		if msg.MediaID != nil {
			one := []domain.Message{msg}
			if e := i.hydrateMedia(ctx, one); e == nil {
				msg = one[0]
			}
		}
		payload, e := json.Marshal(messageUpdatePayload(msg))
		if e != nil {
			return e
		}
		_, e = i.channels.AppendUpdate(ctx, sp.ChatID, payload)
		return e
	})
	if err != nil {
		return domain.Message{}, err
	}
	if i.chPub != nil {
		_ = i.chPub.PublishToChannel(ctx, sp.ChatID, frame("new_message", messageUpdatePayload(msg)))
	}
	return msg, nil
}

// channelMediaType выводит тип сообщения из mime медиа (photo/video/document).
func (i *Interactor) channelMediaType(ctx context.Context, mediaID int64) string {
	dims, err := i.mediaAccess.DimsByIDs(ctx, []int64{mediaID})
	if err != nil {
		return "document"
	}
	switch mime := dims[mediaID].Mime; {
	case strings.HasPrefix(mime, "image/"):
		return "photo"
	case strings.HasPrefix(mime, "video/"):
		return "video"
	default:
		return "document"
	}
}

// suggestedPostInfo — read-модель предложенного поста (с именем автора).
func (i *Interactor) suggestedPostInfo(ctx context.Context, sp domain.SuggestedPost) domain.SuggestedPostInfo {
	info := domain.SuggestedPostInfo{
		ID: sp.ID, ChatID: sp.ChatID, AuthorID: sp.AuthorID,
		AuthorName: i.userCard(ctx, sp.AuthorID).DisplayName,
		Text:       sp.Text, Entities: sp.Entities, MediaID: sp.MediaID,
		Status: sp.Status, CreatedAt: sp.CreatedAt.UnixMilli(),
	}
	if sp.PublishAt != nil {
		info.PublishAt = sp.PublishAt.UnixMilli()
	}
	if sp.DecidedBy != nil {
		info.DecidedBy = *sp.DecidedBy
	}
	if sp.DecidedAt != nil {
		info.DecidedAt = sp.DecidedAt.UnixMilli()
	}
	return info
}

// notifyAuthorDecision шлёт автору сервисное сообщение о решении по его предложке
// (в приватный чат с сервисным аккаунтом). Название канала едет данными — клиент
// собирает локализованную фразу.
func (i *Interactor) notifyAuthorDecision(ctx context.Context, sp domain.SuggestedPost, approved bool) {
	action := "suggest_post_rejected"
	if approved {
		action = "suggest_post_approved"
	}
	title := ""
	if i.groups != nil {
		if card, err := i.groups.Card(ctx, sp.ChatID, sp.AuthorID); err == nil {
			title = card.Title
		}
	}
	b, _ := json.Marshal(map[string]any{"action": action, "chat": title})
	_ = i.PostServiceMessage(ctx, sp.AuthorID, string(b))
}

// publishSuggestedToAdmins рассылает состояние предложки решающим её админам.
func (i *Interactor) publishSuggestedToAdmins(ctx context.Context, chatID int64, info domain.SuggestedPostInfo) {
	if i.publisher == nil || i.groups == nil {
		return
	}
	admins, err := i.groups.AdminIDs(ctx, chatID)
	if err != nil {
		return
	}
	f := frame("suggested_post_update", map[string]any{"chat_id": chatID, "post": info})
	for _, uid := range admins {
		_ = i.publisher.PublishToUser(ctx, uid, f)
	}
}

// publishSuggestedToAuthor рассылает автору статус его предложки.
func (i *Interactor) publishSuggestedToAuthor(ctx context.Context, authorID int64, info domain.SuggestedPostInfo) {
	if i.publisher == nil {
		return
	}
	f := frame("suggested_post_update", map[string]any{"chat_id": info.ChatID, "post": info})
	_ = i.publisher.PublishToUser(ctx, authorID, f)
}
