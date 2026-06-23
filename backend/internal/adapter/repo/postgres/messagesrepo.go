package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// MessagesRepo is a postgres-backed adapter implementing the chat usecase's MessageRepo port.
type MessagesRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.MessageRepo = (*MessagesRepo)(nil)

func NewMessagesRepo(pool *pgxpool.Pool) *MessagesRepo { return &MessagesRepo{pool: pool} }

// NextSeq atomically increments and returns the chat's sequence counter.
func (r *MessagesRepo) NextSeq(ctx context.Context, chatID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var seq int64
	err := q.QueryRow(ctx,
		`UPDATE chats SET last_seq = last_seq + 1 WHERE id=$1 RETURNING last_seq`,
		chatID).Scan(&seq)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return seq, err
}

// FindByClientMsgID returns an existing message for idempotent sends, or domain.ErrNotFound.
func (r *MessagesRepo) FindByClientMsgID(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, created_at, deleted_at
		 FROM messages WHERE chat_id=$1 AND sender_id=$2 AND client_msg_id=$3`,
		chatID, senderID, clientMsgID))
}

// Insert writes a new message row.
func (r *MessagesRepo) Insert(ctx context.Context, m domain.Message) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		 RETURNING id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, created_at, deleted_at`,
		m.ChatID, m.Seq, m.SenderID, m.Type, m.Text, m.ReplyToID, m.ClientMsgID, m.MediaID))
}

// GetHistory returns up to limit messages around offsetSeq. addOffset>0 fetches
// older messages (seq < offsetSeq); addOffset<=0 fetches newer (seq > offsetSeq).
// offsetSeq==0 means "from the newest".
func (r *MessagesRepo) GetHistory(ctx context.Context, chatID, offsetSeq int64, addOffset, limit int) ([]domain.Message, error) {
	q := querier(ctx, r.pool)
	var rows pgx.Rows
	var err error
	switch {
	case offsetSeq == 0:
		rows, err = q.Query(ctx,
			`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, created_at, deleted_at
			 FROM messages WHERE chat_id=$1 ORDER BY seq DESC LIMIT $2`, chatID, limit)
	case addOffset <= 0: // newer than offset
		rows, err = q.Query(ctx,
			`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, created_at, deleted_at
			 FROM messages WHERE chat_id=$1 AND seq>$2 ORDER BY seq ASC LIMIT $3`, chatID, offsetSeq, limit)
	default: // older, inclusive of offset
		rows, err = q.Query(ctx,
			`SELECT id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, created_at, deleted_at
			 FROM messages WHERE chat_id=$1 AND seq<=$2 ORDER BY seq DESC LIMIT $3`, chatID, offsetSeq, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// CountMessages returns the total number of messages in a chat.
func (r *MessagesRepo) CountMessages(ctx context.Context, chatID int64) (int, error) {
	q := querier(ctx, r.pool)
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM messages WHERE chat_id=$1`, chatID).Scan(&n)
	return n, err
}

// CountUnread returns messages in a chat with seq>afterSeq not sent by the user.
func (r *MessagesRepo) CountUnread(ctx context.Context, chatID, userID, afterSeq int64) (int, error) {
	q := querier(ctx, r.pool)
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE chat_id=$1 AND seq>$2 AND sender_id<>$3 AND deleted_at IS NULL`,
		chatID, afterSeq, userID).Scan(&n)
	return n, err
}

// MessageChatID resolves a message id to its chat id. Returns domain.ErrNotFound
// if the message does not exist.
func (r *MessagesRepo) MessageChatID(ctx context.Context, messageID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var chatID int64
	err := q.QueryRow(ctx, `SELECT chat_id FROM messages WHERE id=$1`, messageID).Scan(&chatID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return chatID, err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanMessage(s scanner) (domain.Message, error) {
	var m domain.Message
	var deletedAt *time.Time
	err := s.Scan(&m.ID, &m.ChatID, &m.Seq, &m.SenderID, &m.Type, &m.Text,
		&m.ReplyToID, &m.ClientMsgID, &m.MediaID, &m.CreatedAt, &deletedAt)
	m.Deleted = deletedAt != nil
	return m, err
}

func scanOneMessage(row pgx.Row) (domain.Message, error) {
	m, err := scanMessage(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Message{}, domain.ErrNotFound
	}
	return m, err
}
