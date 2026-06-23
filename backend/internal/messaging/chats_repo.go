package messaging

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrNotFound = errors.New("not found")

type Chat struct {
	ID   int64
	Type string
}

// Dialog is one row of a user's chat list: the chat plus that user's read state
// and the chat's last message (may be zero if empty).
type Dialog struct {
	ChatID       int64
	Type         string
	LastReadSeq  int64
	UnreadCount  int
	Muted        bool
	LastSeq      int64
	LastText     string
	LastSenderID int64
	LastAt       time.Time
	HasLast      bool
}

type ChatsRepo struct{}

func NewChatsRepo() *ChatsRepo { return &ChatsRepo{} }

// FindPrivateChat returns the id of the existing private chat between two users, or ErrNotFound.
func (r *ChatsRepo) FindPrivateChat(ctx context.Context, q Querier, a, b int64) (int64, error) {
	var id int64
	err := q.QueryRow(ctx,
		`SELECT c.id FROM chats c
		 JOIN chat_members m1 ON m1.chat_id=c.id AND m1.user_id=$1
		 JOIN chat_members m2 ON m2.chat_id=c.id AND m2.user_id=$2
		 WHERE c.type='private' LIMIT 1`, a, b).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return id, err
}

// CreatePrivateChat creates a private chat with two members. Caller ensures it doesn't exist.
func (r *ChatsRepo) CreatePrivateChat(ctx context.Context, q Querier, a, b int64) (int64, error) {
	var chatID int64
	if err := q.QueryRow(ctx,
		`INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chatID); err != nil {
		return 0, err
	}
	if _, err := q.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2),($1,$3)`,
		chatID, a, b); err != nil {
		return 0, err
	}
	return chatID, nil
}

// MemberIDs returns the user ids of a chat's members.
func (r *ChatsRepo) MemberIDs(ctx context.Context, q Querier, chatID int64) ([]int64, error) {
	rows, err := q.Query(ctx, `SELECT user_id FROM chat_members WHERE chat_id=$1`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// IsMember reports whether a user belongs to a chat.
func (r *ChatsRepo) IsMember(ctx context.Context, q Querier, chatID, userID int64) (bool, error) {
	var one int
	err := q.QueryRow(ctx,
		`SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ChatPartners returns the distinct user ids that share at least one chat with
// the given user (i.e. people who should see the user's presence).
func (r *ChatsRepo) ChatPartners(ctx context.Context, q Querier, userID int64) ([]int64, error) {
	rows, err := q.Query(ctx,
		`SELECT DISTINCT m2.user_id FROM chat_members m1
		 JOIN chat_members m2 ON m2.chat_id = m1.chat_id AND m2.user_id <> m1.user_id
		 WHERE m1.user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListDialogs returns a user's chats with read state and last message, newest first.
func (r *ChatsRepo) ListDialogs(ctx context.Context, q Querier, userID int64) ([]Dialog, error) {
	rows, err := q.Query(ctx,
		`SELECT c.id, c.type, m.last_read_seq, m.unread_count, m.muted,
		        lm.seq, lm.text, lm.sender_id, lm.created_at
		 FROM chat_members m
		 JOIN chats c ON c.id = m.chat_id
		 LEFT JOIN LATERAL (
		   SELECT seq, text, sender_id, created_at FROM messages
		   WHERE chat_id = c.id AND deleted_at IS NULL
		   ORDER BY seq DESC LIMIT 1
		 ) lm ON true
		 WHERE m.user_id = $1
		 ORDER BY lm.created_at DESC NULLS LAST`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Dialog
	for rows.Next() {
		var d Dialog
		var seq *int64
		var text *string
		var senderID *int64
		var at *time.Time
		if err := rows.Scan(&d.ChatID, &d.Type, &d.LastReadSeq, &d.UnreadCount, &d.Muted,
			&seq, &text, &senderID, &at); err != nil {
			return nil, err
		}
		if seq != nil {
			d.HasLast = true
			d.LastSeq = *seq
			d.LastText = *text
			d.LastSenderID = *senderID
			d.LastAt = *at
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
