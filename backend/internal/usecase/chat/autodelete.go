package chat

import (
	"context"
	"errors"

	"github.com/messenger-denis/backend/internal/domain"
)

// maxAutoDeletePeriod — верхняя граница периода автоудаления (1 год, tweb
// customTimeOptions заканчиваются годом).
const maxAutoDeletePeriod = 366 * 24 * 3600

// MyAutoDelete — глобальный период автоудаления пользователя (для новых чатов).
func (i *Interactor) MyAutoDelete(ctx context.Context, userID int64) (int, error) {
	return i.chats.UserAutoDelete(ctx, userID)
}

// SetMyAutoDelete сохраняет глобальный период (Telegram
// messages.setDefaultHistoryTTL — применяется к чатам, созданным после).
func (i *Interactor) SetMyAutoDelete(ctx context.Context, userID int64, seconds int) error {
	if seconds < 0 || seconds > maxAutoDeletePeriod {
		return domain.ErrForbidden
	}
	return i.chats.SetUserAutoDelete(ctx, userID, seconds)
}

// SetChatAutoDelete задаёт период автоудаления конкретного чата (Telegram
// messages.setHistoryTTL): в приватном — любой участник, в группе/канале —
// админ с правом «Изменение профиля группы». Изменение объявляется сервисным
// сообщением set_ttl (tweb messageActionSetMessagesTTL).
func (i *Interactor) SetChatAutoDelete(ctx context.Context, chatID, actorID int64, seconds int) error {
	if seconds < 0 || seconds > maxAutoDeletePeriod {
		return domain.ErrForbidden
	}
	ok, err := i.chats.IsMember(ctx, chatID, actorID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return err
	}
	if typ == domain.ChatTypeGroup || typ == domain.ChatTypeChannel {
		if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil {
			return err
		}
	}
	if err := i.chats.SetAutoDelete(ctx, chatID, seconds); err != nil {
		return err
	}
	i.postGroupService(ctx, chatID, actorID, domain.NewMessageActionSetMessagesTTL(seconds))
	return nil
}

// PurgeExpiredMessages удаляет «для всех» сообщения с истёкшим auto_delete_at:
// тем же путём, что DeleteMessage «у всех» (fanOutDelete: soft-delete,
// снятие с непрочитанного, delete_message в журнал и живой кадр участникам),
// у broadcast-канала — записью журнала канала. Пост канала уносит своё
// зеркало в группе обсуждения (mirrorDelete, как при обычном удалении — В-1),
// снятый комментарий двигает счётчик поста (publishPostReplies). Возвращает
// число удалённых (вызывается фоновым тикером).
func (i *Interactor) PurgeExpiredMessages(ctx context.Context) (int, error) {
	expired, err := i.msgs.ExpiredMessages(ctx, 200)
	if err != nil || len(expired) == 0 {
		return 0, err
	}
	purged := 0
	for _, e := range expired {
		// Выборка истёкших несёт только ключи; зеркалу, гостю и альбому нужна
		// строка целиком. Уже удалённое (гонка с ручным удалением) — пропуск.
		msg, err := i.msgs.GetByID(ctx, e.ID)
		if errors.Is(err, domain.ErrNotFound) {
			continue
		}
		if err != nil {
			return purged, err
		}
		if msg.Deleted {
			continue
		}
		// broadcast-канал: удаление — запись журнала канала
		// (updateDeleteChannelMessages), без веера по подписчикам.
		broadcast := i.isBroadcast(ctx, msg.ChatID)
		var channelBody map[string]any
		var channelPts int64
		var del *deleteDelivery
		var mirrors []*deleteDelivery
		err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
			if broadcast {
				if e := i.msgs.SoftDelete(ctx, msg.ID); e != nil {
					return e
				}
				channelBody = channelDeletePayload(msg.ChatID, []int64{msg.Seq})
				p, e := i.appendChannelUpdate(ctx, msg.ChatID, "delete_message", channelBody)
				if e != nil {
					return e
				}
				channelPts = p
				mirrors, e = i.mirrorDelete(ctx, msg)
				return e
			}
			author := msg.SenderID
			if msg.IsDiscussionMirror {
				author = 0 // зеркало ничьё (A1-13)
			}
			// Гость обсуждения (автор комментария без членства) получает
			// удаление своего на свои устройства — как в DeleteMessage.
			var extra []int64
			if author != 0 {
				member, e := i.chats.IsMember(ctx, msg.ChatID, author)
				if e != nil {
					return e
				}
				if !member && i.discussionGuestThread(ctx, msg.ChatID, author, msg.ThreadRootID, true) == nil {
					extra = []int64{author}
				}
			}
			var e error
			del, e = i.fanOutDelete(ctx, msg, author, extra)
			return e
		})
		if err != nil {
			return purged, err
		}
		purged++
		if broadcast {
			i.publishChannelUpdate(ctx, msg.ChatID, "delete_message", channelBody, channelPts, 0)
			for _, d := range mirrors {
				i.publishDelete(ctx, d)
			}
			continue
		}
		i.publishDelete(ctx, del)
		i.publishPostReplies(ctx, msg)
	}
	return purged, nil
}
