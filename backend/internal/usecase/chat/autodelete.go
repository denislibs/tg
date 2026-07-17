package chat

import (
	"context"
	"encoding/json"
	"slices"

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
	if typ == "group" || typ == "channel" {
		if err := i.requireRight(ctx, chatID, actorID, domain.RightChangeInfo); err != nil {
			return err
		}
	}
	if err := i.chats.SetAutoDelete(ctx, chatID, seconds); err != nil {
		return err
	}
	actor := i.userCard(ctx, actorID)
	text, _ := json.Marshal(map[string]any{
		"action": "set_ttl", "actor_id": actor.ID, "actor": actor.DisplayName, "ttl": seconds,
	})
	i.postGroupService(ctx, chatID, actorID, string(text))
	return nil
}

// PurgeExpiredMessages удаляет «для всех» сообщения с истёкшим auto_delete_at:
// soft-delete + delete_message в лог обновлений и live-фан-аут каждому
// участнику. Возвращает число удалённых (вызывается фоновым тикером).
func (i *Interactor) PurgeExpiredMessages(ctx context.Context) (int, error) {
	expired, err := i.msgs.ExpiredMessages(ctx, 200)
	if err != nil || len(expired) == 0 {
		return 0, err
	}
	purged := 0
	for _, msg := range expired {
		var members []int64
		err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
			if e := i.msgs.SoftDelete(ctx, msg.ID); e != nil {
				return e
			}
			m, e := i.chats.MemberIDs(ctx, msg.ChatID)
			if e != nil {
				return e
			}
			slices.Sort(m)
			members = m
			payload, e := json.Marshal(deleteUpdatePayload(msg.ChatID, msg.ID, msg.Seq, false))
			if e != nil {
				return e
			}
			date := nowMillis()
			for _, uid := range members {
				if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "delete_message", payload); e != nil {
					return e
				}
			}
			return nil
		})
		if err != nil {
			return purged, err
		}
		purged++
		if i.publisher != nil {
			f := frame("delete_message", deleteUpdatePayload(msg.ChatID, msg.ID, msg.Seq, false))
			for _, uid := range members {
				_ = i.publisher.PublishToUser(ctx, uid, f)
			}
		}
	}
	return purged, nil
}
