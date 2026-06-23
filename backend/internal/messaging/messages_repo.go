package messaging

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type Message struct {
	ID          int64
	ChatID      int64
	Seq         int64
	SenderID    int64
	Type        string
	Text        string
	ReplyToID   *int64
	ClientMsgID *string
	CreatedAt   time.Time
	Deleted     bool
}

type MessagesRepo struct{}

func NewMessagesRepo() *MessagesRepo { return &MessagesRepo{} }

// NextSeq atomically increments and returns the chat's sequence counter.
func (r *MessagesRepo) NextSeq(ctx context.Context, q Querier, chatID int64) (int64, error) {
	var seq int64
	err := q.QueryRow(ctx,
		`UPDATE chats SET last_seq = last_seq + 1 WHERE id=$1 RETURNING last_seq`,
		chatID).Scan(&seq)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return seq, err
}

// FindByClientMsgID returns an existing message for idempotent sends, or ErrNotFound.
func (r *MessagesRepo) FindByClientMsgID(ctx context.Context, q Querier, chatID, senderID int64, clientMsgID string) (Message, error) {
	return r.scanOne(q.QueryRow(ctx,
		`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at
		 FROM messages WHERE chat_id=$1 AND sender_id=$2 AND client_msg_id=$3`,
		chatID, senderID, clientMsgID))
}

// Insert writes a new message row.
func (r *MessagesRepo) Insert(ctx context.Context, q Querier, m Message) (Message, error) {
	return r.scanOne(q.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 RETURNING id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at`,
		m.ChatID, m.Seq, m.SenderID, m.Type, m.Text, m.ReplyToID, m.ClientMsgID))
}

// GetHistory returns up to limit messages around offsetSeq. addOffset>0 fetches
// older messages (seq < offsetSeq); addOffset<=0 fetches newer (seq > offsetSeq).
// offsetSeq==0 means "from the newest".
func (r *MessagesRepo) GetHistory(ctx context.Context, q Querier, chatID, offsetSeq int64, addOffset, limit int) ([]Message, error) {
	var rows pgx.Rows
	var err error
	switch {
	case offsetSeq == 0:
		rows, err = q.Query(ctx,
			`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at
			 FROM messages WHERE chat_id=$1 ORDER BY seq DESC LIMIT $2`, chatID, limit)
	case addOffset <= 0: // newer than offset
		rows, err = q.Query(ctx,
			`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at
			 FROM messages WHERE chat_id=$1 AND seq>$2 ORDER BY seq ASC LIMIT $3`, chatID, offsetSeq, limit)
	default: // older, inclusive of offset
		rows, err = q.Query(ctx,
			`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at
			 FROM messages WHERE chat_id=$1 AND seq<=$2 ORDER BY seq DESC LIMIT $3`, chatID, offsetSeq, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := r.scanRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// CountMessages returns the total number of messages in a chat.
func (r *MessagesRepo) CountMessages(ctx context.Context, q Querier, chatID int64) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM messages WHERE chat_id=$1`, chatID).Scan(&n)
	return n, err
}

// CountUnread returns messages in a chat with seq>afterSeq not sent by the user.
func (r *MessagesRepo) CountUnread(ctx context.Context, q Querier, chatID, userID, afterSeq int64) (int, error) {
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE chat_id=$1 AND seq>$2 AND sender_id<>$3 AND deleted_at IS NULL`,
		chatID, afterSeq, userID).Scan(&n)
	return n, err
}

type scanner interface {
	Scan(dest ...any) error
}

func (r *MessagesRepo) scanRow(s scanner) (Message, error) { return r.scanInto(s) }
func (r *MessagesRepo) scanOne(row pgx.Row) (Message, error) {
	m, err := r.scanInto(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	return m, err
}
func (r *MessagesRepo) scanInto(s scanner) (Message, error) {
	var m Message
	var deletedAt *time.Time
	err := s.Scan(&m.ID, &m.ChatID, &m.Seq, &m.SenderID, &m.Type, &m.Text,
		&m.ReplyToID, &m.ClientMsgID, &m.CreatedAt, &deletedAt)
	m.Deleted = deletedAt != nil
	return m, err
}
