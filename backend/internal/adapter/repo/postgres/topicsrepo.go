package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// TopicsRepo хранит темы форум-групп (forum_topics).
type TopicsRepo struct {
	pool *pgxpool.Pool
}

func NewTopicsRepo(pool *pgxpool.Pool) *TopicsRepo { return &TopicsRepo{pool: pool} }

func (r *TopicsRepo) Create(ctx context.Context, t domain.ForumTopic) (domain.ForumTopic, error) {
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO forum_topics (chat_id, root_msg_id, title, icon_color, icon_emoji, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
		t.ChatID, t.RootMsgID, t.Title, t.IconColor, t.IconEmoji, t.CreatedBy).Scan(&t.ID, &t.CreatedAt)
	return t, err
}

func (r *TopicsRepo) ByID(ctx context.Context, id int64) (domain.ForumTopic, error) {
	var t domain.ForumTopic
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, chat_id, root_msg_id, title, icon_color, icon_emoji, closed, hidden, pinned, pos, is_general, created_by, created_at
		   FROM forum_topics WHERE id=$1`, id).
		Scan(&t.ID, &t.ChatID, &t.RootMsgID, &t.Title, &t.IconColor, &t.IconEmoji, &t.Closed,
			&t.Hidden, &t.Pinned, &t.Pos, &t.IsGeneral, &t.CreatedBy, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ForumTopic{}, domain.ErrNotFound
	}
	return t, err
}

func (r *TopicsRepo) SetClosed(ctx context.Context, id int64, closed bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE forum_topics SET closed=$2 WHERE id=$1`, id, closed)
	return err
}

// EditTopic меняет заголовок/emoji/цвет темы.
func (r *TopicsRepo) EditTopic(ctx context.Context, id int64, title, iconEmoji string, iconColor int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE forum_topics SET title=$2, icon_emoji=$3, icon_color=$4 WHERE id=$1`,
		id, title, iconEmoji, iconColor)
	return err
}

func (r *TopicsRepo) SetHidden(ctx context.Context, id int64, hidden bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE forum_topics SET hidden=$2 WHERE id=$1`, id, hidden)
	return err
}

func (r *TopicsRepo) SetPinned(ctx context.Context, id int64, pinned bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE forum_topics SET pinned=$2 WHERE id=$1`, id, pinned)
	return err
}

// EnsureGeneralTopic идемпотентно создаёт системную тему «General» для чата,
// если её ещё нет, и возвращает её. General всегда первая, её нельзя закрыть/удалить.
func (r *TopicsRepo) EnsureGeneralTopic(ctx context.Context, chatID, createdBy int64) (domain.ForumTopic, error) {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`INSERT INTO forum_topics (chat_id, root_msg_id, title, is_general, created_by)
		 SELECT $1, 0, 'General', true, $2
		  WHERE NOT EXISTS (SELECT 1 FROM forum_topics WHERE chat_id=$1 AND is_general)`,
		chatID, createdBy); err != nil {
		return domain.ForumTopic{}, err
	}
	var t domain.ForumTopic
	err := q.QueryRow(ctx,
		`SELECT id, chat_id, root_msg_id, title, icon_color, icon_emoji, closed, hidden, pinned, pos, is_general, created_by, created_at
		   FROM forum_topics WHERE chat_id=$1 AND is_general`, chatID).
		Scan(&t.ID, &t.ChatID, &t.RootMsgID, &t.Title, &t.IconColor, &t.IconEmoji, &t.Closed,
			&t.Hidden, &t.Pinned, &t.Pos, &t.IsGeneral, &t.CreatedBy, &t.CreatedAt)
	return t, err
}

// ListByChat — темы чата с последним сообщением треда и per-topic состоянием
// для зрителя userID (unread/mentions/mute/last_out — как обычный dialog-ряд).
// Порядок (как в tweb): General первой, затем закреплённые (по pos), затем
// остальные (свежие сверху).
func (r *TopicsRepo) ListByChat(ctx context.Context, chatID, userID int64) ([]domain.TopicRow, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, `
		SELECT t.id, t.chat_id, t.root_msg_id, t.title, t.icon_color, t.icon_emoji,
		       t.closed, t.hidden, t.pinned, t.pos, t.is_general, t.created_by, t.created_at,
		       COALESCE(cnt.n, 0),
		       lm.text, lm.type, lm.created_at, lm.seq, lm.sender_id,
		       (SELECT COALESCE(NULLIF(u.first_name,''), u.display_name) FROM users u WHERE u.id = lm.sender_id),
		       COALESCE(st.muted, false),
		       COALESCE(unr.n, 0),
		       COALESCE(men.n, 0)
		  FROM forum_topics t
		  LEFT JOIN topic_user_state st
		    ON st.chat_id = t.chat_id AND st.root_msg_id = t.root_msg_id AND st.user_id = $2
		  LEFT JOIN LATERAL (
		    SELECT count(*) AS n FROM messages m
		     WHERE m.chat_id = t.chat_id AND m.thread_root_id = t.root_msg_id AND m.deleted_at IS NULL
		  ) cnt ON true
		  LEFT JOIN LATERAL (
		    SELECT m.text, m.type, m.created_at, m.seq, m.sender_id FROM messages m
		     WHERE m.chat_id = t.chat_id AND (m.thread_root_id = t.root_msg_id OR m.id = t.root_msg_id)
		       AND m.deleted_at IS NULL
		     ORDER BY m.seq DESC LIMIT 1
		  ) lm ON true
		  LEFT JOIN LATERAL (
		    -- непрочитанные темы: чужие сообщения треда с seq > last_read_seq
		    SELECT count(*) AS n FROM messages m
		     WHERE m.chat_id = t.chat_id AND m.thread_root_id = t.root_msg_id
		       AND m.deleted_at IS NULL AND m.sender_id <> $2
		       AND m.seq > COALESCE(st.last_read_seq, 0)
		  ) unr ON true
		  LEFT JOIN LATERAL (
		    -- непрочитанные упоминания зрителя в этой теме (message_mentions +
		    -- thread_root_id сообщения); text_mention детектится при вставке.
		    SELECT count(*) AS n FROM message_mentions mm
		     JOIN messages m ON m.id = mm.message_id
		     WHERE mm.chat_id = t.chat_id AND mm.user_id = $2
		       AND m.thread_root_id = t.root_msg_id AND m.deleted_at IS NULL
		       AND mm.seq > COALESCE(st.last_read_seq, 0)
		  ) men ON true
		 WHERE t.chat_id = $1
		 ORDER BY t.is_general DESC,
		          t.pinned DESC,
		          CASE WHEN t.pinned THEN t.pos ELSE 0 END ASC,
		          COALESCE(lm.created_at, t.created_at) DESC`, chatID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.TopicRow
	for rows.Next() {
		var row domain.TopicRow
		var text, typ, sender *string
		var lastSeq *int64
		var lastSender *int64
		if err := rows.Scan(&row.Topic.ID, &row.Topic.ChatID, &row.Topic.RootMsgID, &row.Topic.Title,
			&row.Topic.IconColor, &row.Topic.IconEmoji, &row.Topic.Closed, &row.Topic.Hidden,
			&row.Topic.Pinned, &row.Topic.Pos, &row.Topic.IsGeneral, &row.Topic.CreatedBy, &row.Topic.CreatedAt,
			&row.MsgCount, &text, &typ, &row.LastAt, &lastSeq, &lastSender, &sender,
			&row.Muted, &row.UnreadCount, &row.UnreadMentions); err != nil {
			return nil, err
		}
		if text != nil {
			row.LastText = *text
		}
		if typ != nil {
			row.LastType = *typ
		}
		if sender != nil {
			row.LastSenderName = *sender
		}
		if lastSeq != nil {
			row.LastMsgSeq = *lastSeq
		}
		if lastSender != nil {
			row.LastOut = *lastSender == userID
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// SetTopicRead поднимает last_read_seq темы до max(old, upToSeq) — UPSERT в
// topic_user_state (аналог chat_members.read_seq для конкретной темы).
func (r *TopicsRepo) SetTopicRead(ctx context.Context, chatID, rootMsgID, userID, upToSeq int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `
		INSERT INTO topic_user_state (chat_id, root_msg_id, user_id, last_read_seq)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (chat_id, root_msg_id, user_id)
		DO UPDATE SET last_read_seq = GREATEST(topic_user_state.last_read_seq, EXCLUDED.last_read_seq)`,
		chatID, rootMsgID, userID, upToSeq)
	return err
}

// SetTopicMuted включает/выключает mute темы — UPSERT в topic_user_state.
func (r *TopicsRepo) SetTopicMuted(ctx context.Context, chatID, rootMsgID, userID int64, muted bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `
		INSERT INTO topic_user_state (chat_id, root_msg_id, user_id, muted)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (chat_id, root_msg_id, user_id)
		DO UPDATE SET muted = EXCLUDED.muted`,
		chatID, rootMsgID, userID, muted)
	return err
}
