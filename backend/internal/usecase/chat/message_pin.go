package chat

import (
	"context"
	"slices"

	"github.com/messenger-denis/backend/internal/domain"
)

// SetPin pins or unpins a message in a chat and fans out a pin_message update to
// all members (so everyone's pinned bar updates live). Gated by the group's
// default PIN permission for plain members / RightPinMessages for admins.
func (i *Interactor) SetPin(ctx context.Context, chatID, msgID, userID int64, pin bool) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	if i.groups != nil {
		if err := i.requirePermOrRight(ctx, chatID, userID, domain.PermPinMessages, domain.RightPinMessages); err != nil {
			return err
		}
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if cur.ChatID != chatID || cur.Deleted {
		return domain.ErrNotFound
	}

	var members []int64
	var pp *peerPayloads
	ptsByUser := map[int64]int64{}
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if pin {
			if e := i.chats.PinMessage(ctx, chatID, msgID, userID); e != nil {
				return e
			}
		} else if e := i.chats.UnpinMessage(ctx, chatID, msgID); e != nil {
			return e
		}
		mem, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		pp, e = i.newPeerPayloads(ctx, chatID, map[string]any{"id": cur.Seq, "pinned": pin})
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			payload, e := pp.payload(uid)
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
	if i.publisher != nil {
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, pp.frame("pin_message", uid, map[string]any{"pts": ptsByUser[uid]}))
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

// MessageViewers returns the ids of members who have seen the message (read up to
// its seq), excluding its sender. The caller must be a member.
func (i *Interactor) MessageViewers(ctx context.Context, chatID, msgID, userID int64) ([]int64, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	msg, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return nil, err
	}
	if msg.ChatID != chatID {
		return nil, domain.ErrNotFound
	}
	return i.chats.Viewers(ctx, chatID, msg.Seq, msg.SenderID)
}
