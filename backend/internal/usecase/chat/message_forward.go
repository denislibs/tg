package chat

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/messenger-denis/backend/internal/domain"
)

// ForwardInput selects messages from one chat to copy into another.
type ForwardInput struct {
	FromChatID int64
	ToChatID   int64
	MsgIDs     []int64
	SenderID   int64
}

// ForwardMessages copies the given messages into ToChatID as new messages with
// forward attribution ("Переслано от X"). The caller must be a member of both
// chats. Forwarding a forward preserves the ORIGINAL origin (like Telegram).
// Each copy fans out a normal new_message update/frame, so receivers and the
// /sync catch-up treat it like any incoming message.
func (i *Interactor) ForwardMessages(ctx context.Context, in ForwardInput) ([]domain.Message, error) {
	if len(in.MsgIDs) == 0 {
		return nil, nil
	}
	for _, chatID := range []int64{in.FromChatID, in.ToChatID} {
		ok, err := i.chats.IsMember(ctx, chatID, in.SenderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, domain.ErrNotFound
		}
	}

	var created []domain.Message
	var members []int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		mem, e := i.chats.MemberIDs(ctx, in.ToChatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		date := nowMillis()
		for _, srcID := range in.MsgIDs {
			src, e := i.msgs.GetByID(ctx, srcID)
			if e != nil {
				return e
			}
			if src.ChatID != in.FromChatID || src.Deleted {
				return domain.ErrNotFound
			}
			// Preserve the true origin across forward-of-forward.
			fwdUser := src.FwdFromUserID
			if fwdUser == nil {
				fwdUser = &src.SenderID
			}
			fwdChat := src.FwdFromChatID
			if fwdChat == nil {
				fwdChat = &src.ChatID
			}
			fwdMsg := src.FwdFromMsgID
			if fwdMsg == nil {
				fwdMsg = &src.ID
			}
			fwdDate := src.FwdDate
			if fwdDate == nil {
				fwdDate = &src.CreatedAt
			}

			seq, e := i.msgs.NextSeq(ctx, in.ToChatID)
			if e != nil {
				return e
			}
			msg, e := i.msgs.Insert(ctx, domain.Message{
				ChatID: in.ToChatID, Seq: seq, SenderID: in.SenderID,
				Type: src.Type, Text: src.Text, MediaID: src.MediaID,
				FwdFromUserID: fwdUser, FwdFromChatID: fwdChat, FwdFromMsgID: fwdMsg, FwdDate: fwdDate,
			})
			if e != nil {
				return e
			}
			payload, e := json.Marshal(messageUpdatePayload(msg))
			if e != nil {
				return e
			}
			for _, uid := range members {
				if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "new_message", payload); e != nil {
					return e
				}
				if uid != in.SenderID {
					if e := i.chats.IncUnread(ctx, in.ToChatID, uid); e != nil {
						return e
					}
				}
			}
			created = append(created, msg)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if i.publisher != nil {
		for _, msg := range created {
			f := frame("new_message", messageUpdatePayload(msg))
			for _, uid := range members {
				_ = i.publisher.PublishToUser(ctx, uid, f)
				if i.notifier != nil && uid != in.SenderID {
					i.notifier.NotifyNewMessage(ctx, uid, msg.ChatID, msg.ID, msg.Seq, msg.SenderID, msg.Text)
				}
			}
		}
	}
	return created, nil
}
