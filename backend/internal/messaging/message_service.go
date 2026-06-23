package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
)

// Notifier is told about a new message for a recipient, so an offline recipient
// can be sent a push notification. Optional; never blocks delivery.
type Notifier interface {
	NotifyNewMessage(ctx context.Context, recipientID, chatID, msgID, seq, senderID int64, text string)
}

// SendInput describes an outgoing message.
type SendInput struct {
	ChatID      int64
	SenderID    int64
	Type        string
	Text        string
	ReplyToID   *int64
	ClientMsgID string // optional; enables idempotency
	MediaID     *int64
}

// Send inserts a message, appends a new_message update to every member (bumping
// unread for non-senders), and — after commit — publishes a live new_message
// frame to each member. Idempotent on ClientMsgID (duplicates publish nothing).
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
	if in.MediaID != nil {
		var ownerID int64
		err := s.pool.QueryRow(ctx, `SELECT owner_id FROM media WHERE id=$1`, *in.MediaID).Scan(&ownerID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && ownerID != in.SenderID) {
			return Message{}, ErrNotFound // media absent or not owned by sender
		}
		if err != nil {
			return Message{}, err // propagate real DB errors (don't mask as 403)
		}
	}

	var msg Message
	var recipients []int64 // non-nil only when a NEW message was inserted
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if in.ClientMsgID != "" {
			if existing, e := s.msgs.FindByClientMsgID(ctx, tx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
				msg = existing
				return nil
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
			MediaID: in.MediaID,
		})
		if e != nil {
			return e
		}
		members, e := s.chats.MemberIDs(ctx, tx, in.ChatID)
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
		recipients = members
		return nil
	})
	if err != nil {
		return Message{}, err
	}
	if recipients != nil {
		f := frame("new_message", messageUpdatePayload(msg))
		for _, uid := range recipients {
			if s.publisher != nil {
				_ = s.publisher.PublishToUser(ctx, uid, f)
			}
			if s.notifier != nil && uid != in.SenderID {
				s.notifier.NotifyNewMessage(ctx, uid, msg.ChatID, msg.ID, msg.Seq, msg.SenderID, msg.Text)
			}
		}
	}
	return msg, nil
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
	var members []int64
	var effective int64
	var advanced bool
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		var cur int64
		if e := tx.QueryRow(ctx,
			`SELECT last_read_seq FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
			chatID, userID).Scan(&cur); e != nil {
			return e
		}
		effective = upToSeq
		if cur > effective {
			effective = cur
		}
		advanced = effective > cur
		unread, e := s.msgs.CountUnread(ctx, tx, chatID, userID, effective)
		if e != nil {
			return e
		}
		if _, e := tx.Exec(ctx,
			`UPDATE chat_members SET last_read_seq=$3, unread_count=$4
			 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, effective, unread); e != nil {
			return e
		}
		m, e := s.chats.MemberIDs(ctx, tx, chatID)
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
			if _, e := s.updates.AppendUpdate(ctx, tx, uid, 1, date, "read", payload); e != nil {
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
	if s.publisher != nil && advanced {
		f := frame("read", map[string]any{"chat_id": chatID, "user_id": userID, "up_to_seq": effective})
		for _, uid := range members {
			_ = s.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
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
		"media_id": m.MediaID, "created_at": m.CreatedAt,
	}
}

// Typing publishes an ephemeral typing indicator to the other chat members.
// No DB write. No-op if the user isn't a member or no publisher is attached.
func (s *Service) Typing(ctx context.Context, chatID, userID int64) error {
	if s.publisher == nil {
		return nil
	}
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil || !ok {
		return err
	}
	members, err := s.chats.MemberIDs(ctx, s.pool, chatID)
	if err != nil {
		return err
	}
	f := frame("typing", map[string]any{"chat_id": chatID, "user_id": userID})
	for _, uid := range members {
		if uid != userID {
			_ = s.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return nil
}
