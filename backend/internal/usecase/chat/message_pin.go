package chat

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// SetPin pins or unpins a message in a chat and fans out a pin_message update to
// all members (so everyone's pinned bar updates live). Gated by tweb hasRights
// 'pin_messages' (requirePin).
func (i *Interactor) SetPin(ctx context.Context, chatID, msgID, userID int64, pin bool) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	if err := i.requirePin(ctx, chatID, userID); err != nil {
		return err
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if cur.ChatID != chatID || cur.Deleted {
		return domain.ErrNotFound
	}

	// broadcast-канал: закреп — одна запись журнала канала
	// (updatePinnedChannelMessages) вместо строки у каждого подписчика.
	broadcast := i.isBroadcast(ctx, chatID)
	var channelBody map[string]any
	var channelPts int64
	var members []int64
	var pinAddr chatAddress
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if pin {
			if e := i.chats.PinMessage(ctx, chatID, msgID, userID); e != nil {
				return e
			}
		} else if e := i.chats.UnpinMessage(ctx, chatID, msgID); e != nil {
			return e
		}
		if broadcast {
			channelBody = channelPinPayload(chatID, cur.Seq, pin)
			p, e := i.appendChannelUpdate(ctx, chatID, "pin_message", channelBody)
			channelPts = p
			return e
		}
		mem, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		addr, e := i.peerAddress(ctx, chatID)
		if e != nil {
			return e
		}
		pinAddr = addr
		date := nowMillis()
		for _, uid := range members {
			payload, e := json.Marshal(pinPayload(addr.forViewer(uid), cur.Seq, pin))
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "pin_message", payload)
			if e != nil {
				return e
			}
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return err
	}
	if broadcast {
		i.publishChannelUpdate(ctx, chatID, "pin_message", channelBody, channelPts, 0)
	}
	if i.publisher != nil && !broadcast {
		for _, uid := range members {
			body := pinPayload(pinAddr.forViewer(uid), cur.Seq, pin)
			_ = i.publisher.PublishToUser(ctx, uid, framePts("pin_message", body, ptsByUser[uid]))
		}
	}
	// Закрепление оставляет след в ленте (tweb messageActionPinMessage). У
	// открепления парного экшена в Telegram нет (в lang.ts только
	// Chat.Service.Group.UpdatedPinnedMessage/ActionPinnedNoText, ключа «открепил»
	// не существует) — снимаем закрепление молча.
	if pin {
		// messageActionPinMessage НЕ НЕСЁТ НИЧЕГО: ни адреса цели, ни превью.
		// Цель — reply_to самого служебного сообщения, превью строит клиент той
		// же wrapMessageForReply, что рисует цитату ответа и строку списка
		// чатов. Прежде сервер клал в действие msg_id, msg_type, «имя» медиа и
		// текст, обрезанный до 100 символов, — то есть склеивал за клиента
		// фразу целиком.
		target := cur.Seq
		_, _ = i.Send(ctx, SendInput{
			ChatID: chatID, SenderID: userID,
			Action: domain.NewMessageActionPinMessage(), ReplyToID: &target,
		})
	}
	return nil
}

// ListPins returns a chat's pinned messages (newest pin first) for a member.
func (i *Interactor) ListPins(ctx context.Context, chatID, userID int64) ([]domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	return i.chats.ListPins(ctx, chatID)
}

// Порог «кто прочитал» (tweb appConfig chat_read_mark_size_threshold и
// chat_read_mark_expire_period; своего appConfig у нас нет — значения
// Telegram по умолчанию).
const (
	chatReadMarkSizeThreshold = 100
	chatReadMarkExpirePeriod  = 7 * 24 * time.Hour
)

// MessageViewers returns the ids of members who have seen the message (read up to
// its seq), excluding its sender.
//
// Кому — правило tweb canViewMessageReadParticipants
// (appMessagesManager.ts:12314-12340), которое сервер Telegram и держит:
// только АВТОРУ сообщения, не в вещательном канале, в чате не больше
// chatReadMarkSizeThreshold участников и не позже chatReadMarkExpirePeriod
// после отправки. Иначе domain.ErrForbidden: чужое «кто прочитал» и читатели
// постов канала (тот же состав подписчиков) не отдаются.
func (i *Interactor) MessageViewers(ctx context.Context, chatID, msgID, userID int64) ([]int64, error) {
	a, err := i.chats.Access(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !a.Member {
		return nil, domain.ErrNotFound
	}
	msg, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return nil, err
	}
	if msg.ChatID != chatID {
		return nil, domain.ErrNotFound
	}
	if msg.SenderID != userID || a.Type == domain.ChatTypeChannel || time.Since(msg.CreatedAt) >= chatReadMarkExpirePeriod {
		return nil, domain.ErrForbidden
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return nil, err
	}
	if len(members) > chatReadMarkSizeThreshold {
		return nil, domain.ErrForbidden
	}
	return i.chats.Viewers(ctx, chatID, msg.Seq, msg.SenderID)
}

// requirePin — порт tweb hasRights 'pin_messages': в канале закрепляет админ с
// pin_messages ИЛИ post_messages (редактор прав канала бита pin_messages не
// предлагает вовсе, так что без второго условия закреплял бы один владелец);
// в группе — дефолт чата ∧ ¬личный запрет у участника, бит у админа. Личный
// чат прав не знает (i.groups == nil — без гейта).
func (i *Interactor) requirePin(ctx context.Context, chatID, userID int64) error {
	if i.groups == nil {
		return nil
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return err
	}
	if typ != domain.ChatTypeChannel {
		if typ != domain.ChatTypeGroup {
			return nil
		}
		return i.requirePermOrRight(ctx, chatID, userID, domain.PermPinMessages, domain.RightPinMessages)
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return domain.ErrForbidden
	}
	if domain.HasRight(m.Role, m.Rights, domain.RightPinMessages) || domain.HasRight(m.Role, m.Rights, domain.RightPostMessages) {
		return nil
	}
	return domain.ErrForbidden
}
