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
	return i.groups.SetForum(ctx, chatID, enabled)
}

// CreateTopic создаёт тему: сервисное сообщение-корень + строка forum_topics.
func (i *Interactor) CreateTopic(ctx context.Context, chatID, userID int64, title string, iconColor int) (domain.ForumTopic, error) {
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
	return i.topics.Create(ctx, domain.ForumTopic{
		ChatID: chatID, RootMsgID: root.ID, Title: title, IconColor: iconColor, CreatedBy: userID,
	})
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
	return i.topics.ListByChat(ctx, chatID)
}

// CloseTopic закрывает/открывает тему (создатель темы или админ).
func (i *Interactor) CloseTopic(ctx context.Context, topicID, userID int64, closed bool) error {
	if i.topics == nil {
		return domain.ErrNotFound
	}
	t, err := i.topics.ByID(ctx, topicID)
	if err != nil {
		return err
	}
	if t.CreatedBy != userID {
		member, e := i.groups.GetMember(ctx, t.ChatID, userID)
		if e != nil || (member.Role != "creator" && member.Role != "admin") {
			return domain.ErrForbidden
		}
	}
	return i.topics.SetClosed(ctx, topicID, closed)
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
	i.hydrateGifts(ctx, userID, msgs)
	return msgs, count, nil
}
