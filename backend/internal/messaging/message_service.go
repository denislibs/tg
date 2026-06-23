package messaging

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// SendInput describes an outgoing message.
type SendInput struct {
	ChatID      int64
	SenderID    int64
	Type        string
	Text        string
	ReplyToID   *int64
	ClientMsgID string // optional; enables idempotency
}

// Send inserts a message and appends a new_message update to every member,
// bumping unread for everyone except the sender. Idempotent on ClientMsgID.
func (s *Service) Send(ctx context.Context, in SendInput) (Message, error) {
	ok, err := s.chats.IsMember(ctx, s.pool, in.ChatID, in.SenderID)
	if err != nil {
		return Message{}, err
	}
	if !ok {
		return Message{}, ErrNotFound
	}
	if in.Type == "" {
		in.Type = "text"
	}

	var msg Message
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if in.ClientMsgID != "" {
			if existing, e := s.msgs.FindByClientMsgID(ctx, tx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				msg = existing
				return nil // duplicate send: return the original, no new updates
			} else if e != ErrNotFound {
				return e
			}
		}
		seq, e := s.msgs.NextSeq(ctx, tx, in.ChatID)
		if e != nil {
			return e
		}
		var cmid *string
		if in.ClientMsgID != "" {
			cmid = &in.ClientMsgID
		}
		msg, e = s.msgs.Insert(ctx, tx, Message{
			ChatID: in.ChatID, Seq: seq, SenderID: in.SenderID,
			Type: in.Type, Text: in.Text, ReplyToID: in.ReplyToID, ClientMsgID: cmid,
		})
		if e != nil {
			return e
		}
		members, e := s.chats.MemberIDs(ctx, tx, in.ChatID)
		if e != nil {
			return e
		}
		payload, e := json.Marshal(messageUpdatePayload(msg))
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := s.updates.AppendUpdate(ctx, tx, uid, 1, date, "new_message", payload); e != nil {
				return e
			}
			if uid != in.SenderID {
				if _, e := tx.Exec(ctx,
					`UPDATE chat_members SET unread_count = unread_count + 1 WHERE chat_id=$1 AND user_id=$2`,
					in.ChatID, uid); e != nil {
					return e
				}
			}
		}
		return nil
	})
	return msg, err
}

// MarkRead advances a member's last_read_seq, recomputes unread, and appends a
// read update to all members (so senders see read receipts and other devices sync).
func (s *Service) MarkRead(ctx context.Context, chatID, userID, upToSeq int64) error {
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		unread, e := s.msgs.CountUnread(ctx, tx, chatID, userID, upToSeq)
		if e != nil {
			return e
		}
		if _, e := tx.Exec(ctx,
			`UPDATE chat_members SET last_read_seq=GREATEST(last_read_seq,$3), unread_count=$4
			 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, upToSeq, unread); e != nil {
			return e
		}
		members, e := s.chats.MemberIDs(ctx, tx, chatID)
		if e != nil {
			return e
		}
		payload, e := json.Marshal(map[string]any{
			"chat_id": chatID, "user_id": userID, "up_to_seq": upToSeq,
		})
		if e != nil {
			return e
		}
		date := nowMillis()
		for _, uid := range members {
			if _, e := s.updates.AppendUpdate(ctx, tx, uid, 1, date, "read", payload); e != nil {
				return e
			}
		}
		return nil
	})
}

func (s *Service) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func messageUpdatePayload(m Message) map[string]any {
	return map[string]any{
		"chat_id": m.ChatID, "msg_id": m.ID, "seq": m.Seq,
		"sender_id": m.SenderID, "type": m.Type, "text": m.Text,
		"created_at": m.CreatedAt,
	}
}
