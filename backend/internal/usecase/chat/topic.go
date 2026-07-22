package chat

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Форум-топики (Telegram forum topics): темы поверх тредовой механики
// thread_root_id. Корень темы — сервисное сообщение о создании; сообщения
// темы несут thread_root_id = root_msg_id и идут обычным Send (фан-аут штатный).

const maxTopicTitle = 128

// SetForum включает/выключает темы у группы (право CHANGE_INFO, как в tweb).
func (i *Interactor) SetForum(ctx context.Context, chatID, actorID int64, enabled bool) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil {
		return err
	}
	if err := i.groups.SetForum(ctx, chatID, enabled); err != nil {
		return err
	}
	if enabled {
		// При включении тем гарантируем системную тему «General» (как в tweb).
		if _, err := i.topics.EnsureGeneralTopic(ctx, chatID, actorID); err != nil {
			return err
		}
	}
	return nil
}

// CreateTopic создаёт тему: сервисное сообщение-корень + строка forum_topics.
func (i *Interactor) CreateTopic(ctx context.Context, chatID, userID int64, title, iconEmoji string, iconColor int) (domain.ForumTopic, error) {
	if i.topics == nil {
		return domain.ForumTopic{}, domain.ErrNotFound
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > maxTopicTitle {
		return domain.ForumTopic{}, domain.ErrTooLong
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.ForumTopic{}, err
	}
	if !ok {
		return domain.ForumTopic{}, domain.ErrNotFound
	}
	name := i.userCard(ctx, userID).ShortName()
	root, err := i.Send(ctx, SendInput{
		ChatID: chatID, SenderID: userID, Type: "service",
		Text: fmt.Sprintf("%s создал(а) тему «%s»", name, title),
	})
	if err != nil {
		return domain.ForumTopic{}, err
	}
	if iconColor < 0 {
		iconColor = 0
	}
	iconEmoji = sanitizeTopicEmoji(iconEmoji)
	return i.topics.Create(ctx, domain.ForumTopic{
		ChatID: chatID, RootMsgID: root.ID, Title: title, IconColor: iconColor,
		IconEmoji: iconEmoji, CreatedBy: userID,
	})
}

// sanitizeTopicEmoji ограничивает иконку темы коротким unicode-emoji (без custom-emoji
// инфраструктуры): режем по рунам, чтобы не хранить произвольный текст.
func sanitizeTopicEmoji(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > 8 {
		return ""
	}
	return s
}

// ListTopics — темы чата (участникам), свежие сверху.
func (i *Interactor) ListTopics(ctx context.Context, chatID, userID int64) ([]domain.TopicRow, error) {
	if i.topics == nil {
		return nil, nil
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	return i.topics.ListByChat(ctx, chatID, userID)
}

// MarkTopicRead помечает тему прочитанной до upToSeq (Telegram readDiscussion
// с threadId): поднимает персональный last_read_seq темы. Вызывается фронтом
// при открытии треда темы.
func (i *Interactor) MarkTopicRead(ctx context.Context, chatID, rootMsgID, userID, upToSeq int64) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	return i.topics.SetTopicRead(ctx, chatID, rootMsgID, userID, upToSeq)
}

// SetTopicMuted включает/выключает уведомления темы для пользователя
// (Telegram updateNotifySettings на forumTopic).
func (i *Interactor) SetTopicMuted(ctx context.Context, chatID, rootMsgID, userID int64, muted bool) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	return i.topics.SetTopicMuted(ctx, chatID, rootMsgID, userID, muted)
}

// topicManagerOK — создатель темы или админ/создатель чата (mirror tweb manage_topics).
func (i *Interactor) topicManagerOK(ctx context.Context, t domain.ForumTopic, userID int64) bool {
	if t.CreatedBy == userID {
		return true
	}
	if i.groups == nil {
		return false
	}
	member, e := i.groups.GetMember(ctx, t.ChatID, userID)
	return e == nil && (member.Role == "creator" || member.Role == "admin")
}

// CloseTopic закрывает/открывает тему (создатель темы или админ). General закрыть нельзя.
func (i *Interactor) CloseTopic(ctx context.Context, topicID, userID int64, closed bool) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	t, err := i.topics.ByID(ctx, topicID)
	if err != nil {
		return err
	}
	if t.IsGeneral {
		return domain.ErrForbidden
	}
	if !i.topicManagerOK(ctx, t, userID) {
		return domain.ErrForbidden
	}
	return i.topics.SetClosed(ctx, topicID, closed)
}

// EditTopic меняет заголовок/emoji/цвет темы (создатель темы или админ).
// У General можно менять только заголовок (в Telegram — админом).
func (i *Interactor) EditTopic(ctx context.Context, topicID, userID int64, title, iconEmoji string, iconColor int) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	t, err := i.topics.ByID(ctx, topicID)
	if err != nil {
		return err
	}
	if !i.topicManagerOK(ctx, t, userID) {
		return domain.ErrForbidden
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > maxTopicTitle {
		return domain.ErrTooLong
	}
	if t.IsGeneral {
		// General сохраняет системную иконку — правим только заголовок.
		return i.topics.EditTopic(ctx, topicID, title, t.IconEmoji, t.IconColor)
	}
	if iconColor < 0 {
		iconColor = 0
	}
	return i.topics.EditTopic(ctx, topicID, title, sanitizeTopicEmoji(iconEmoji), iconColor)
}

// SetTopicHidden сворачивает/разворачивает тему (право CHANGE_INFO). Разрешено и для General.
func (i *Interactor) SetTopicHidden(ctx context.Context, topicID, userID int64, hidden bool) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	t, err := i.topics.ByID(ctx, topicID)
	if err != nil {
		return err
	}
	if err := i.requireRight(ctx, t.ChatID, userID, domain.RightChangeInfo); err != nil {
		return err
	}
	return i.topics.SetHidden(ctx, topicID, hidden)
}

// SetTopicPinned закрепляет/открепляет тему (право CHANGE_INFO). General и так всегда первая.
func (i *Interactor) SetTopicPinned(ctx context.Context, topicID, userID int64, pinned bool) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	t, err := i.topics.ByID(ctx, topicID)
	if err != nil {
		return err
	}
	if t.IsGeneral {
		return domain.ErrForbidden
	}
	if err := i.requireRight(ctx, t.ChatID, userID, domain.RightChangeInfo); err != nil {
		return err
	}
	return i.topics.SetPinned(ctx, topicID, pinned)
}

// ListThreadMessages — сообщения треда (форум-топика) по возрастанию.
func (i *Interactor) ListThreadMessages(ctx context.Context, chatID, rootID, userID int64, offset, limit int) ([]domain.Message, int, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, 0, err
	}
	if !ok {
		return nil, 0, domain.ErrNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	msgs, err := i.msgs.ListThread(ctx, chatID, rootID, offset, limit)
	if err != nil {
		return nil, 0, err
	}
	count, err := i.msgs.CountThread(ctx, chatID, rootID)
	if err != nil {
		return nil, 0, err
	}
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return nil, 0, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
	i.hydrateChecklists(ctx, msgs)
	i.hydrateGifts(ctx, userID, msgs)
	i.hydrateGiveaways(ctx, userID, msgs)
	i.hydratePaidMedia(ctx, userID, msgs)
	return msgs, count, nil
}
