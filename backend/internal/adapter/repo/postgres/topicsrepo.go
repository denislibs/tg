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
		`INSERT INTO forum_topics (chat_id, root_msg_id, title, icon_color, created_by)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
		t.ChatID, t.RootMsgID, t.Title, t.IconColor, t.CreatedBy).Scan(&t.ID, &t.CreatedAt)
	return t, err
}

func (r *TopicsRepo) ByID(ctx context.Context, id int64) (domain.ForumTopic, error) {
	var t domain.ForumTopic
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, chat_id, root_msg_id, title, icon_color, closed, created_by, created_at
		   FROM forum_topics WHERE id=$1`, id).
		Scan(&t.ID, &t.ChatID, &t.RootMsgID, &t.Title, &t.IconColor, &t.Closed, &t.CreatedBy, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ForumTopic{}, domain.ErrNotFound
	}
	return t, err
}

func (r *TopicsRepo) SetClosed(ctx context.Context, id int64, closed bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE forum_topics SET closed=$2 WHERE id=$1`, id, closed)
	return err
}

// ListByChat — темы чата с последним сообщением треда (свежие сверху).
func (r *TopicsRepo) ListByChat(ctx context.Context, chatID int64) ([]domain.TopicRow, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, `
		SELECT t.id, t.chat_id, t.root_msg_id, t.title, t.icon_color, t.closed, t.created_by, t.created_at,
		       COALESCE(cnt.n, 0),
		       lm.text, lm.type, lm.created_at,
		       (SELECT COALESCE(NULLIF(u.first_name,''), u.display_name) FROM users u WHERE u.id = lm.sender_id)
		  FROM forum_topics t
		  LEFT JOIN LATERAL (
		    SELECT count(*) AS n FROM messages m
		     WHERE m.chat_id = t.chat_id AND m.thread_root_id = t.root_msg_id AND m.deleted_at IS NULL
		  ) cnt ON true
		  LEFT JOIN LATERAL (
		    SELECT m.text, m.type, m.created_at, m.sender_id FROM messages m
		     WHERE m.chat_id = t.chat_id AND (m.thread_root_id = t.root_msg_id OR m.id = t.root_msg_id)
		       AND m.deleted_at IS NULL
		     ORDER BY m.seq DESC LIMIT 1
		  ) lm ON true
		 WHERE t.chat_id = $1
		 ORDER BY COALESCE(lm.created_at, t.created_at) DESC`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.TopicRow
	for rows.Next() {
		var row domain.TopicRow
		var text, typ, sender *string
		if err := rows.Scan(&row.Topic.ID, &row.Topic.ChatID, &row.Topic.RootMsgID, &row.Topic.Title,
			&row.Topic.IconColor, &row.Topic.Closed, &row.Topic.CreatedBy, &row.Topic.CreatedAt,
			&row.MsgCount, &text, &typ, &row.LastAt, &sender); err != nil {
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
		out = append(out, row)
	}
	return out, rows.Err()
}
