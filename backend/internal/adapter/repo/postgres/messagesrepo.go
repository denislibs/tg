package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
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

// The full ordered column list every message SELECT/RETURNING uses, so the scan
// order in scanMessage stays in sync across all queries.
const messageCols = `id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, created_at, deleted_at, thread_root_id, edited_at, fwd_from_user_id, fwd_from_chat_id, fwd_from_msg_id, fwd_date`

// messageColsPrefixed returns messageCols with each column qualified by a table
// alias (for JOINs where bare column names like chat_id would be ambiguous).
func messageColsPrefixed(alias string) string {
	cols := strings.Split(messageCols, ", ")
	for i, c := range cols {
		cols[i] = alias + "." + c
	}
	return strings.Join(cols, ", ")
}

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
		`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND sender_id=$2 AND client_msg_id=$3`,
		chatID, senderID, clientMsgID))
}

// GetByID returns a single message by id, or domain.ErrNotFound.
func (r *MessagesRepo) GetByID(ctx context.Context, msgID int64) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`SELECT `+messageCols+` FROM messages WHERE id=$1`, msgID))
}

// GetAround returns a window of messages centered on centerSeq (older + the
// message + newer), ascending, excluding deleted/self-hidden, plus whether the
// real top/bottom of history was reached. Used for jump-to-message.
func (r *MessagesRepo) GetAround(ctx context.Context, chatID, userID, centerSeq int64, limit int) ([]domain.Message, bool, bool, error) {
	if limit <= 0 {
		limit = 40
	}
	half := limit / 2
	q := querier(ctx, r.pool)
	const excl = ` AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.msg_id=messages.id AND h.user_id=$4)`
	scan := func(rows pgx.Rows, err error) ([]domain.Message, error) {
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []domain.Message
		for rows.Next() {
			m, e := scanMessage(rows)
			if e != nil {
				return nil, e
			}
			out = append(out, m)
		}
		return out, rows.Err()
	}
	// Older incl. center (DESC), then newer (ASC).
	older, err := scan(q.Query(ctx,
		`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND seq<=$2`+excl+` ORDER BY seq DESC LIMIT $3`,
		chatID, centerSeq, half+1, userID))
	if err != nil {
		return nil, false, false, err
	}
	newer, err := scan(q.Query(ctx,
		`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND seq>$2`+excl+` ORDER BY seq ASC LIMIT $3`,
		chatID, centerSeq, half, userID))
	if err != nil {
		return nil, false, false, err
	}
	reachedTop := len(older) < half+1
	reachedBottom := len(newer) < half
	// older is DESC → reverse to ASC, then append newer.
	out := make([]domain.Message, 0, len(older)+len(newer))
	for i := len(older) - 1; i >= 0; i-- {
		out = append(out, older[i])
	}
	out = append(out, newer...)
	return out, reachedTop, reachedBottom, nil
}

// SearchMessages returns messages in a chat whose text matches q (case-insensitive
// substring), newest first, plus the total match count. Excludes deleted.
func (r *MessagesRepo) SearchMessages(ctx context.Context, chatID int64, q string, offset, limit int) ([]domain.Message, int, error) {
	qq := querier(ctx, r.pool)
	pattern := "%" + q + "%"
	var count int
	if err := qq.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL AND text ILIKE $2`,
		chatID, pattern).Scan(&count); err != nil {
		return nil, 0, err
	}
	rows, err := qq.Query(ctx,
		`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND deleted_at IS NULL AND text ILIKE $2
		 ORDER BY seq DESC LIMIT $3 OFFSET $4`, chatID, pattern, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, e := scanMessage(rows)
		if e != nil {
			return nil, 0, e
		}
		out = append(out, m)
	}
	return out, count, rows.Err()
}

// GetByIDs returns messages for the given ids (order unspecified); missing ids
// are simply absent. Empty input → empty result.
func (r *MessagesRepo) GetByIDs(ctx context.Context, ids []int64) ([]domain.Message, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx, `SELECT `+messageCols+` FROM messages WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		m, e := scanMessage(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Insert writes a new message row (incl. forward attribution when set).
func (r *MessagesRepo) Insert(ctx context.Context, m domain.Message) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, thread_root_id, fwd_from_user_id, fwd_from_chat_id, fwd_from_msg_id, fwd_date)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		 RETURNING `+messageCols,
		m.ChatID, m.Seq, m.SenderID, m.Type, m.Text, m.ReplyToID, m.ClientMsgID, m.MediaID, m.ThreadRootID,
		m.FwdFromUserID, m.FwdFromChatID, m.FwdFromMsgID, m.FwdDate))
}

// UpdateText replaces a message's text and stamps edited_at=now(); returns the
// updated row.
func (r *MessagesRepo) UpdateText(ctx context.Context, msgID int64, text string) (domain.Message, error) {
	q := querier(ctx, r.pool)
	return scanOneMessage(q.QueryRow(ctx,
		`UPDATE messages SET text=$2, edited_at=now() WHERE id=$1 RETURNING `+messageCols, msgID, text))
}

// SoftDelete marks a message deleted for everyone (deleted_at=now()).
func (r *MessagesRepo) SoftDelete(ctx context.Context, msgID int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx, `UPDATE messages SET deleted_at=now(), text='' WHERE id=$1`, msgID)
	return err
}

// HideForUser hides a message for a single user ("delete for me"); idempotent.
func (r *MessagesRepo) HideForUser(ctx context.Context, userID, msgID int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`INSERT INTO message_hides (user_id, msg_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, msgID)
	return err
}

// GetHistory returns up to limit messages around offsetSeq, excluding messages
// the user hid for themselves. addOffset>0 fetches older messages (seq <
// offsetSeq); addOffset<=0 fetches newer (seq > offsetSeq); offsetSeq==0 means
// "from the newest".
func (r *MessagesRepo) GetHistory(ctx context.Context, chatID, userID, offsetSeq int64, addOffset, limit int) ([]domain.Message, error) {
	q := querier(ctx, r.pool)
	// Skip deleted (never shown) and rows this user hid for themselves. Placeholder
	// differs per query shape.
	const exclN = ` AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.msg_id=messages.id AND h.user_id=$%d)`
	var rows pgx.Rows
	var err error
	switch {
	case offsetSeq == 0:
		rows, err = q.Query(ctx,
			`SELECT `+messageCols+` FROM messages WHERE chat_id=$1`+fmt.Sprintf(exclN, 3)+` ORDER BY seq DESC LIMIT $2`,
			chatID, limit, userID)
	case addOffset <= 0: // newer than offset
		rows, err = q.Query(ctx,
			`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND seq>$2`+fmt.Sprintf(exclN, 4)+` ORDER BY seq ASC LIMIT $3`,
			chatID, offsetSeq, limit, userID)
	default: // older, inclusive of offset
		rows, err = q.Query(ctx,
			`SELECT `+messageCols+` FROM messages WHERE chat_id=$1 AND seq<=$2`+fmt.Sprintf(exclN, 4)+` ORDER BY seq DESC LIMIT $3`,
			chatID, offsetSeq, limit, userID)
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

// ListThread returns messages belonging to a thread (thread_root_id) in a chat,
// ascending by seq, excluding deleted messages.
func (r *MessagesRepo) ListThread(ctx context.Context, chatID, threadRootID int64, offset, limit int) ([]domain.Message, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT `+messageCols+`
		 FROM messages WHERE chat_id=$1 AND thread_root_id=$2 AND deleted_at IS NULL ORDER BY seq ASC LIMIT $3 OFFSET $4`,
		chatID, threadRootID, limit, offset)
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

// CountThread returns the number of non-deleted messages in a thread.
func (r *MessagesRepo) CountThread(ctx context.Context, chatID, threadRootID int64) (int, error) {
	q := querier(ctx, r.pool)
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE chat_id=$1 AND thread_root_id=$2 AND deleted_at IS NULL`,
		chatID, threadRootID).Scan(&n)
	return n, err
}

// CountMessages returns the total number of messages in a chat.
func (r *MessagesRepo) CountMessages(ctx context.Context, chatID int64) (int, error) {
	q := querier(ctx, r.pool)
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL`, chatID).Scan(&n)
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
		&m.ReplyToID, &m.ClientMsgID, &m.MediaID, &m.CreatedAt, &deletedAt, &m.ThreadRootID,
		&m.EditedAt, &m.FwdFromUserID, &m.FwdFromChatID, &m.FwdFromMsgID, &m.FwdDate)
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
