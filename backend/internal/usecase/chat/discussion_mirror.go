package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// mirrorChannelPost кладёт зеркало поста канала в его группу обсуждения.
// Telegram-модель: комментарии — это обычный тред в группе, отвечающий на
// зеркало, поэтому зеркало обязано появиться вместе с постом (в той же
// транзакции), иначе у поста не будет треда.
//
// Единственное место, где рождается зеркало: все четыре пути публикации в
// канал (PostToChannel, Send с медиа, Forward, одобрение предложенного поста)
// зовут именно его.
func (i *Interactor) mirrorChannelPost(ctx context.Context, post domain.Message) error {
	if i.groups == nil {
		return nil
	}
	disc, err := i.groups.GetDiscussion(ctx, post.ChatID)
	if err != nil || disc == 0 {
		// у канала нет привязанного обсуждения — зеркалить некуда, это не ошибка
		return nil
	}
	// идемпотентность: ретрай/повторная доставка не должны плодить зеркала
	// (в базе то же самое держит уникальный индекс)
	if existing, err := i.msgs.MirrorByPost(ctx, post.ChatID, post.ID); err != nil {
		return err
	} else if existing != 0 {
		return nil
	}

	seq, err := i.msgs.NextSeq(ctx, disc)
	if err != nil {
		return err
	}
	channelID := post.ChatID
	postID := post.ID
	date := post.CreatedAt
	_, err = i.msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: seq, SenderID: post.SenderID,
		Type: post.Type, Text: post.Text, Entities: post.Entities,
		MediaID: post.MediaID, GroupedID: post.GroupedID, PollID: post.PollID,
		// автор бабла в UI — канал, как в Telegram
		SendAsChatID: &channelID,
		// отсюда кнопка «перейти к оригиналу»
		FwdFromChatID: &channelID, FwdFromMsgID: &postID, FwdDate: &date,
		IsDiscussionMirror: true,
	})
	return err
}
