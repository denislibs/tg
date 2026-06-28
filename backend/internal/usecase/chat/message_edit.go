package chat

import (
	"context"
	"encoding/json"
	"slices"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// EditMessage replaces the text of the caller's own message, stamps edited_at,
// and fans out an "edit_message" update to every member (so all see the new text
// and the "edited" marker). Text-only; author-only.
func (i *Interactor) EditMessage(ctx context.Context, chatID, msgID, userID int64, text string, entities []domain.MessageEntity) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return domain.Message{}, err
	}
	if cur.ChatID != chatID || cur.Deleted {
		return domain.Message{}, domain.ErrNotFound
	}
	if cur.SenderID != userID {
		return domain.Message{}, domain.ErrForbidden // only the author may edit
	}
	if utf8.RuneCountInString(text) > maxMessageRunes {
		return domain.Message{}, domain.ErrTooLong
	}
	entities = sanitizeEntities(entities)

	var msg domain.Message
	var members []int64
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		m, e := i.msgs.UpdateText(ctx, msgID, text, entities)
		if e != nil {
			return e
		}
		msg = m
		mem, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(mem)
		members = mem
		payload, e := json.Marshal(editUpdatePayload(msg))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "edit_message", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return domain.Message{}, err
	}
	if i.publisher != nil {
		f := frame("edit_message", editUpdatePayload(msg))
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return msg, nil
}

// DeleteMessage removes a message. revoke=true deletes for everyone (soft-delete
// + broadcast to all members); revoke=false hides it only for the caller (their
// own devices sync via a for_me delete frame). "For everyone" requires the author.
func (i *Interactor) DeleteMessage(ctx context.Context, chatID, msgID, userID int64, revoke bool) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return err
	}
	if cur.ChatID != chatID {
		return domain.ErrNotFound
	}
	if revoke && cur.SenderID != userID {
		// In a private 1:1 either participant may delete for everyone (Telegram).
		// Elsewhere a non-author needs the group-admin delete-messages right.
		typ, e := i.chats.ChatType(ctx, chatID)
		if e != nil {
			return e
		}
		if typ != "private" {
			if err := i.requireRight(ctx, chatID, userID, domain.RightDeleteMessages); err != nil {
				return domain.ErrForbidden
			}
		}
	}

	var members []int64
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		date := nowMillis()
		if revoke {
			if e := i.msgs.SoftDelete(ctx, msgID); e != nil {
				return e
			}
			mem, e := i.chats.MemberIDs(ctx, chatID)
			if e != nil {
				return e
			}
			slices.Sort(mem)
			members = mem
			payload, e := json.Marshal(deleteUpdatePayload(chatID, msgID, cur.Seq, false))
			if e != nil {
				return e
			}
			for _, uid := range members {
				if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "delete_message", payload); e != nil {
					return e
				}
			}
			return nil
		}
		// delete for me: hide for this user only; sync only their own devices.
		if e := i.msgs.HideForUser(ctx, userID, msgID); e != nil {
			return e
		}
		members = []int64{userID}
		payload, e := json.Marshal(deleteUpdatePayload(chatID, msgID, cur.Seq, true))
		if e != nil {
			return e
		}
		_, e = i.updates.AppendUpdate(ctx, userID, 1, date, "delete_message", payload)
		return e
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		f := frame("delete_message", deleteUpdatePayload(chatID, msgID, cur.Seq, !revoke))
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}
