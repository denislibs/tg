package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// ChatsRepo is a postgres-backed adapter implementing the chat usecase's ChatRepo port.
type ChatsRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.ChatRepo = (*ChatsRepo)(nil)

func NewChatsRepo(pool *pgxpool.Pool) *ChatsRepo { return &ChatsRepo{pool: pool} }

// FindPrivate returns the id of the existing private chat between two users, or domain.ErrNotFound.
func (r *ChatsRepo) FindPrivate(ctx context.Context, a, b int64) (int64, error) {
	q := querier(ctx, r.pool)
	var id int64
	err := q.QueryRow(ctx,
		`SELECT c.id FROM chats c
		 JOIN chat_members m1 ON m1.chat_id=c.id AND m1.user_id=$1
		 JOIN chat_members m2 ON m2.chat_id=c.id AND m2.user_id=$2
		 WHERE c.type='private' LIMIT 1`, a, b).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
}

// CreatePrivate creates a private chat with two members. It takes a tx-scoped
// advisory lock keyed on the sorted user pair so concurrent first-time creation
// is serialized; it must run inside a transaction (via TxManager).
//
// FindSaved returns the id of the user's "Saved Messages" self-chat, or
// domain.ErrNotFound (a single-member chat of type 'saved').
func (r *ChatsRepo) FindSaved(ctx context.Context, userID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var id int64
	err := q.QueryRow(ctx,
		`SELECT c.id FROM chats c
		 JOIN chat_members m ON m.chat_id=c.id AND m.user_id=$1
		 WHERE c.type='saved' LIMIT 1`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
}

// CreateSaved creates the user's "Saved Messages" chat (type 'saved', one member).
// A tx-scoped advisory lock keyed on the user serializes concurrent first-time
// creation; it must run inside a transaction (via TxManager).
func (r *ChatsRepo) CreateSaved(ctx context.Context, userID int64) (int64, error) {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, fmt.Sprintf("saved:%d", userID)); err != nil {
		return 0, err
	}
	var chatID int64
	if err := q.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('saved') RETURNING id`).Scan(&chatID); err != nil {
		return 0, err
	}
	if _, err := q.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2)`, chatID, userID); err != nil {
		return 0, err
	}
	return chatID, nil
}

func (r *ChatsRepo) CreatePrivate(ctx context.Context, a, b int64) (int64, error) {
	q := querier(ctx, r.pool)
	lo, hi := a, b
	if lo > hi {
		lo, hi = hi, lo
	}
	lockKey := fmt.Sprintf("private:%d:%d", lo, hi)
	if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
		return 0, err
	}
	var chatID int64
	// Новый приватный чат наследует глобальный период автоудаления инициатора
	// (Telegram default history TTL применяется к новым чатам).
	if err := q.QueryRow(ctx,
		`INSERT INTO chats (type, auto_delete_period)
		 VALUES ('private', (SELECT auto_delete_period FROM users WHERE id=$1))
		 RETURNING id`, a).Scan(&chatID); err != nil {
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
func (r *ChatsRepo) MemberIDs(ctx context.Context, chatID int64) ([]int64, error) {
	q := querier(ctx, r.pool)
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
// ChatType returns a chat's type ('private'|'group'|'channel'|'saved').
func (r *ChatsRepo) ChatType(ctx context.Context, chatID int64) (string, error) {
	q := querier(ctx, r.pool)
	var t string
	err := q.QueryRow(ctx, `SELECT type FROM chats WHERE id=$1`, chatID).Scan(&t)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return t, err
}

func (r *ChatsRepo) IsMember(ctx context.Context, chatID, userID int64) (bool, error) {
	q := querier(ctx, r.pool)
	var one int
	err := q.QueryRow(ctx,
		`SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ChatPartners returns the distinct user ids that share at least one chat with
// the given user.
func (r *ChatsRepo) ChatPartners(ctx context.Context, userID int64) ([]int64, error) {
	q := querier(ctx, r.pool)
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
func (r *ChatsRepo) ListDialogs(ctx context.Context, userID int64) ([]domain.Dialog, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT c.id, c.type, c.title, COALESCE(c.username,''),
		        COALESCE('/media/' || c.photo_media_id || '/content', ''),
		        m.last_read_seq, m.unread_count,
		        (m.muted OR (m.muted_until IS NOT NULL AND m.muted_until > now())),
		        m.pinned_at IS NOT NULL, m.archived, c.is_forum,
		        COALESCE(CASE
		          WHEN c.type = 'private' THEN (SELECT om.last_read_seq FROM chat_members om WHERE om.chat_id = c.id AND om.user_id <> $1 LIMIT 1)
		          WHEN c.type = 'group'   THEN (SELECT MIN(om.last_read_seq) FROM chat_members om WHERE om.chat_id = c.id AND om.user_id <> $1)
		          ELSE 0
		        END, 0) AS peer_read_seq,
		        lm.seq, lm.text, lm.sender_id, lm.created_at, COALESCE(lm.media_id,0), lm.type, lm.forwarded, lm.sender_name,
		        peer.id, peer.display_name, peer.avatar_url, peer.is_verified,
		        c.auto_delete_period
		 FROM chat_members m
		 JOIN chats c ON c.id = m.chat_id
		 LEFT JOIN LATERAL (
		   SELECT seq, text, sender_id, created_at, media_id, type,
		          (fwd_from_user_id IS NOT NULL OR fwd_from_chat_id IS NOT NULL) AS forwarded,
		          (SELECT COALESCE(NULLIF(u.first_name,''), u.display_name) FROM users u WHERE u.id = messages.sender_id) AS sender_name
		   FROM messages
		   WHERE chat_id = c.id AND deleted_at IS NULL
		   ORDER BY seq DESC LIMIT 1
		 ) lm ON true
		 LEFT JOIN LATERAL (
		   SELECT u.id, u.display_name, u.avatar_url, u.is_verified
		   FROM chat_members om JOIN users u ON u.id = om.user_id
		   WHERE om.chat_id = c.id AND om.user_id <> $1
		   LIMIT 1
		 ) peer ON c.type = 'private'
		 WHERE m.user_id = $1
		   -- Скрываем служебные группы обсуждения канала: доступ к ним только через
		   -- «Комментарии» (тред), в списке диалогов они не нужны.
		   AND c.id NOT IN (SELECT discussion_chat_id FROM chats WHERE discussion_chat_id IS NOT NULL)
		 -- закреплённые сверху (свежий пин — первым), затем по дате последнего сообщения
		 ORDER BY m.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Dialog
	for rows.Next() {
		var d domain.Dialog
		var seq *int64
		var text *string
		var senderID *int64
		var at *time.Time
		var mediaID *int64
		var msgType *string
		var forwarded *bool
		var senderName *string
		var peerID *int64
		var peerName *string
		var peerAvatar *string
		var peerVerified *bool
		if err := rows.Scan(&d.ChatID, &d.Type, &d.Title, &d.Username, &d.PhotoURL, &d.LastReadSeq, &d.UnreadCount, &d.Muted, &d.Pinned, &d.Archived, &d.IsForum, &d.PeerReadSeq,
			&seq, &text, &senderID, &at, &mediaID, &msgType, &forwarded, &senderName,
			&peerID, &peerName, &peerAvatar, &peerVerified, &d.AutoDeletePeriod); err != nil {
			return nil, err
		}
		if forwarded != nil {
			d.LastForwarded = *forwarded
		}
		if seq != nil {
			d.HasLast = true
			d.LastSeq = *seq
			d.LastText = *text
			d.LastSenderID = *senderID
			d.LastAt = *at
			if mediaID != nil {
				d.LastMediaID = *mediaID
			}
			if msgType != nil {
				d.LastType = *msgType
			}
			if senderName != nil {
				d.LastSenderName = *senderName
			}
		}
		if peerID != nil {
			p := domain.DialogPeer{ID: *peerID}
			if peerName != nil {
				p.DisplayName = *peerName
			}
			if peerAvatar != nil {
				p.AvatarURL = *peerAvatar
			}
			if peerVerified != nil {
				p.Verified = *peerVerified
			}
			d.Peer = &p
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// IncUnread bumps a member's unread counter by one.
func (r *ChatsRepo) IncUnread(ctx context.Context, chatID, userID int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`UPDATE chat_members SET unread_count = unread_count + 1 WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID)
	return err
}

// CurrentReadSeq returns a member's current last_read_seq.
func (r *ChatsRepo) CurrentReadSeq(ctx context.Context, chatID, userID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var cur int64
	err := q.QueryRow(ctx,
		`SELECT last_read_seq FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&cur)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return cur, err
}

// SetRead sets a member's last_read_seq and unread_count.
func (r *ChatsRepo) SetRead(ctx context.Context, chatID, userID, seq int64, unread int) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`UPDATE chat_members SET last_read_seq=$3, unread_count=$4
		 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, seq, unread)
	return err
}

// PinMessage pins a message in a chat (idempotent).
func (r *ChatsRepo) PinMessage(ctx context.Context, chatID, msgID, byUser int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx,
		`INSERT INTO pinned_messages (chat_id, msg_id, pinned_by) VALUES ($1,$2,$3)
		 ON CONFLICT (chat_id, msg_id) DO NOTHING`, chatID, msgID, byUser)
	return err
}

// UnpinMessage removes a pin.
func (r *ChatsRepo) UnpinMessage(ctx context.Context, chatID, msgID int64) error {
	q := querier(ctx, r.pool)
	_, err := q.Exec(ctx, `DELETE FROM pinned_messages WHERE chat_id=$1 AND msg_id=$2`, chatID, msgID)
	return err
}

// ListPins returns the chat's pinned messages, newest pin first.
func (r *ChatsRepo) ListPins(ctx context.Context, chatID int64) ([]domain.Message, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT `+messageColsPrefixed("m")+`
		 FROM pinned_messages p JOIN messages m ON m.id=p.msg_id
		 WHERE p.chat_id=$1 AND m.deleted_at IS NULL ORDER BY p.pinned_at DESC`, chatID)
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

// Viewers returns the ids of members who have read up to at least seq, excluding
// the message's sender (the "seen by" list for a message).
func (r *ChatsRepo) Viewers(ctx context.Context, chatID, seq, excludeUser int64) ([]int64, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT user_id FROM chat_members WHERE chat_id=$1 AND last_read_seq>=$2 AND user_id<>$3 ORDER BY user_id`,
		chatID, seq, excludeUser)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if e := rows.Scan(&id); e != nil {
			return nil, e
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// SetAutoDelete задаёт период автоудаления чата (0 — выключить).
func (r *ChatsRepo) SetAutoDelete(ctx context.Context, chatID int64, seconds int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET auto_delete_period=$2 WHERE id=$1`, chatID, seconds)
	return err
}

// UserAutoDelete — глобальный период автоудаления пользователя (для новых чатов).
func (r *ChatsRepo) UserAutoDelete(ctx context.Context, userID int64) (int, error) {
	var p int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT auto_delete_period FROM users WHERE id=$1`, userID).Scan(&p)
	return p, err
}

// SetUserAutoDelete сохраняет глобальный период автоудаления пользователя.
func (r *ChatsRepo) SetUserAutoDelete(ctx context.Context, userID int64, seconds int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE users SET auto_delete_period=$2 WHERE id=$1`, userID, seconds)
	return err
}
