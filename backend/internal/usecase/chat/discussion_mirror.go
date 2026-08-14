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
// Единственное место, где рождается зеркало — его зовут ВСЕ пути вставки
// сообщения (PostToChannel, Send, ForwardMessages, publishApprovedPost)
// БЕЗУСЛОВНО, самим хелпером. «Это пост канала или нет» решается ЗДЕСЬ, по
// типу чата-получателя, а не на месте вызова по полю сообщения:
// ThreadRootID приходит из HTTP/WS-фрейма и не валидируется на
// принадлежность чату (в отличие от ReplyToID), плюс то же поле
// переиспользуют форум-топики — гейтить по нему «это пост» означало бы, что
// обычный пост в канал с обсуждением, отправленный со сфабрикованным
// thread_root_id, навсегда остаётся без зеркала и без треда, штатным API,
// без каких-либо ухищрений.
//
// Комментарии живут в группе обсуждения (или форум-топики — в группе), а не
// в канале, поэтому досюда как «пост» и не долетают: проверка типа чата
// ниже отсекает их так же надёжно, как заодно отсекает Send в любой
// private/group чат.
func (i *Interactor) mirrorChannelPost(ctx context.Context, post domain.Message) error {
	if i.groups == nil {
		return nil
	}
	// GetDiscussion ниже сам по себе почти достаточен (у группы/привата
	// discussion_chat_id не выставляется штатными путями), но
	// EnableDiscussion/LinkDiscussion не проверяют тип чата и технически
	// позволяют привязать «обсуждение» к обычной группе (отдельный баг вне
	// рамок этой задачи) — явная проверка типа не даёт такой группе начать
	// зеркалить в себя каждое сообщение своих участников.
	typ, err := i.chats.ChatType(ctx, post.ChatID)
	if err != nil {
		// та же логика, что и у ошибки GetDiscussion ниже: пост уже вставлен
		// этой же транзакцией, chats-строка точно существует — любая ошибка
		// тут реальный сбой и обязана откатить публикацию.
		return err
	}
	if typ != "channel" {
		return nil
	}
	disc, err := i.groups.GetDiscussion(ctx, post.ChatID)
	if err != nil {
		// транзиентная ошибка (обрыв соединения и т.п.) — не «обсуждения нет»:
		// GroupRepo.GetDiscussion кодирует «нет обсуждения» через disc==0 с
		// err==nil (COALESCE discussion_chat_id в 0), а не через ошибку. Здесь
		// пост уже вставлен той же транзакцией, так что chats-строка канала
		// точно существует — любая ошибка тут реальный сбой и обязана откатить
		// публикацию, иначе пост останется без треда комментариев навсегда.
		return err
	}
	if disc == 0 {
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
