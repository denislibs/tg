package chat

import (
	"context"
	"slices"

	"github.com/messenger-denis/backend/internal/domain"
)

// SuggestProfilePhoto posts a service message into the private chat between
// fromUserID and toUserID offering a new profile photo. The suggested photo
// rides on the message's media_id (preview) and the same media id is kept in
// the action JSON so the recipient can accept it later. Mirrors Telegram
// photos.uploadContactProfilePhoto with suggest=true.
func (i *Interactor) SuggestProfilePhoto(ctx context.Context, fromUserID, toUserID, mediaID int64) (domain.Message, error) {
	if fromUserID == toUserID {
		return domain.Message{}, domain.ErrInvalid
	}
	chatID, err := i.CreatePrivateChat(ctx, fromUserID, toUserID)
	if err != nil {
		return domain.Message{}, err
	}
	// Id предложенной аватарки хранился ДВАЖДЫ — в JSON действия и на media_id
	// самого сообщения. Остаётся одно место: media_id, из которого фото и
	// собирается конструктором photo на границе (Message.ToWire).
	mid := mediaID
	return i.Send(ctx, SendInput{
		ChatID:   chatID,
		SenderID: fromUserID,
		Action:   domain.NewMessageActionSuggestProfilePhoto(nil, false),
		MediaID:  &mid,
	})
}

// AcceptProfilePhotoSuggestion accepts a "suggested a profile photo" service
// message: the suggested photo is added to the accepting user's own gallery
// (promoted to current avatar) and the service message is flagged accepted so
// every device stops showing the "Set Photo" button. Only the recipient (not
// the suggester) may accept, and only once.
func (i *Interactor) AcceptProfilePhotoSuggestion(ctx context.Context, userID, msgID int64) error {
	if i.profilePics == nil {
		return domain.ErrNotFound // profile-photo gallery not wired
	}
	m, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if m.Deleted {
		return domain.ErrNotFound
	}
	act, ok := m.Action.(domain.MessageActionSuggestProfilePhoto)
	if !ok {
		return domain.ErrNotFound
	}
	if act.Accepted {
		return domain.ErrConflict // already accepted
	}
	// Only the recipient of the suggestion may accept it.
	if m.SenderID == userID {
		return domain.ErrForbidden
	}
	member, err := i.chats.IsMember(ctx, m.ChatID, userID)
	if err != nil {
		return err
	}
	if !member {
		return domain.ErrForbidden
	}
	// Предложенная аватарка — медиа самого сообщения; второго места, где лежал
	// бы её id, больше нет.
	if m.MediaID == nil || *m.MediaID <= 0 {
		return domain.ErrInvalid
	}
	if _, err := i.profilePics.AddProfilePhoto(ctx, userID, *m.MediaID, nil); err != nil {
		return err
	}

	// Отмечаем действие принятым и рассылаем правку, чтобы кнопка «Установить
	// фото» пропала на всех устройствах. Получатель не автор, поэтому
	// author-only EditMessage обходится.
	act.Accepted = true
	var members []int64
	ptsByUser := map[int64]int64{}
	var pp *peerPayloads
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		msg, e := i.msgs.UpdateAction(ctx, msgID, act)
		if e != nil {
			return e
		}
		mem, e := i.chats.MemberIDs(ctx, m.ChatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		pp, e = i.newPeerPayloads(ctx, m.ChatID, editUpdatePayload(msg))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			p, e := pp.payload(uid)
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "edit_message", p)
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
		fresh, e := i.msgs.GetByID(ctx, msgID)
		if e == nil {
			fp, e := i.newPeerPayloads(ctx, m.ChatID, editUpdatePayload(fresh))
			if e == nil {
				for _, uid := range members {
					_ = i.publisher.PublishToUser(ctx, uid, fp.frame("edit_message", uid, map[string]any{"pts": ptsByUser[uid]}))
				}
			}
		}
	}
	return nil
}
