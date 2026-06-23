package chat

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/messenger-denis/backend/internal/domain"
)

// Send inserts a message, appends a new_message update to every member (bumping
// unread for non-senders), and — after commit — publishes a live new_message
// frame to each member. Idempotent on ClientMsgID (duplicates publish nothing).
func (i *Interactor) Send(ctx context.Context, in SendInput) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, in.ChatID, in.SenderID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	if in.Type == "" {
		in.Type = "text"
	}
	if in.MediaID != nil {
		ownerID, err := i.mediaAccess.OwnerID(ctx, *in.MediaID)
		if errors.Is(err, domain.ErrNotFound) || (err == nil && ownerID != in.SenderID) {
			return domain.Message{}, domain.ErrNotFound // media absent or not owned by sender
		}
		if err != nil {
			return domain.Message{}, err // propagate real DB errors (don't mask as 403)
		}
	}

	var msg domain.Message
	var recipients []int64 // non-nil only when a NEW message was inserted
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if in.ClientMsgID != "" {
			if existing, e := i.msgs.FindByClientMsgID(ctx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				msg = existing
				return nil
			} else if !errors.Is(e, domain.ErrNotFound) {
				return e
			}
		}
		seq, e := i.msgs.NextSeq(ctx, in.ChatID)
		if e != nil {
			return e
		}
		var cmid *string
		if in.ClientMsgID != "" {
			cmid = &in.ClientMsgID
		}
		msg, e = i.msgs.Insert(ctx, domain.Message{
			ChatID: in.ChatID, Seq: seq, SenderID: in.SenderID,
			Type: in.Type, Text: in.Text, ReplyToID: in.ReplyToID, ClientMsgID: cmid,
			MediaID: in.MediaID,
		})
		if e != nil {
			return e
		}
		members, e := i.chats.MemberIDs(ctx, in.ChatID)
		if e != nil {
			return e
		}
		slices.Sort(members)
		payload, e := json.Marshal(messageUpdatePayload(msg))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "new_message", payload); e != nil {
				return e
			}
			if uid != in.SenderID {
				if e := i.chats.IncUnread(ctx, in.ChatID, uid); e != nil {
					return e
				}
			}
		}
		recipients = members
		return nil
	})
	if err != nil {
		return domain.Message{}, err
	}
	if recipients != nil {
		f := frame("new_message", messageUpdatePayload(msg))
		for _, uid := range recipients {
			if i.publisher != nil {
				_ = i.publisher.PublishToUser(ctx, uid, f)
			}
			if i.notifier != nil && uid != in.SenderID {
				i.notifier.NotifyNewMessage(ctx, uid, msg.ChatID, msg.ID, msg.Seq, msg.SenderID, msg.Text)
			}
		}
	}
	return msg, nil
}

// MarkRead advances a member's last_read_seq, recomputes unread, and appends a
// read update to all members (so senders see read receipts and other devices sync).
func (i *Interactor) MarkRead(ctx context.Context, chatID, userID, upToSeq int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	var members []int64
	var effective int64
	var advanced bool
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		cur, e := i.chats.CurrentReadSeq(ctx, chatID, userID)
		if e != nil {
			return e
		}
		effective = upToSeq
		if cur > effective {
			effective = cur
		}
		advanced = effective > cur
		unread, e := i.msgs.CountUnread(ctx, chatID, userID, effective)
		if e != nil {
			return e
		}
		if e := i.chats.SetRead(ctx, chatID, userID, effective, unread); e != nil {
			return e
		}
		m, e := i.chats.MemberIDs(ctx, chatID)
		if e != nil {
			return e
		}
		slices.Sort(m)
		members = m
		payload, e := json.Marshal(map[string]any{
			"chat_id": chatID, "user_id": userID, "up_to_seq": effective,
		})
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := i.updates.AppendUpdate(ctx, uid, 1, date, "read", payload); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	// Only fan out when the read marker actually advanced — a no-op re-read
	// must not spam every member with a redundant read frame.
	if i.publisher != nil && advanced {
		f := frame("read", map[string]any{"chat_id": chatID, "user_id": userID, "up_to_seq": effective})
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}

// Typing publishes an ephemeral typing indicator to the other chat members.
// No DB write. No-op if the user isn't a member or no publisher is attached.
func (i *Interactor) Typing(ctx context.Context, chatID, userID int64) error {
	if i.publisher == nil {
		return nil
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil || !ok {
		return err
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return err
	}
	f := frame("typing", map[string]any{"chat_id": chatID, "user_id": userID})
	for _, uid := range members {
		if uid != userID {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}
