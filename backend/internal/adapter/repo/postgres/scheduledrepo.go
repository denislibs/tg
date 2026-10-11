package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// ScheduledRepo хранит очередь отложенных сообщений: строка — полный снимок
// отправки (колонки + jsonb params, миграция 0168).
type ScheduledRepo struct {
	pool *pgxpool.Pool
}

func NewScheduledRepo(pool *pgxpool.Pool) *ScheduledRepo { return &ScheduledRepo{pool: pool} }

const scheduledCols = `id, chat_id, sender_id, type, text, entities, reply_to_id, media_id, send_at, created_at, when_online, repeat_period, client_msg_id, params, web_page`

func scanScheduled(s scanner) (domain.ScheduledMessage, error) {
	var m domain.ScheduledMessage
	var entitiesRaw, paramsRaw, webPageRaw []byte
	err := s.Scan(&m.ID, &m.ChatID, &m.SenderID, &m.Type, &m.Text, &entitiesRaw, &m.ReplyToID, &m.MediaID,
		&m.SendAt, &m.CreatedAt, &m.WhenOnline, &m.RepeatPeriod, &m.ClientMsgID, &paramsRaw, &webPageRaw)
	if err != nil {
		return m, err
	}
	if len(entitiesRaw) > 0 && string(entitiesRaw) != "null" {
		_ = json.Unmarshal(entitiesRaw, &m.Entities)
	}
	// Снимок, который не читается, — строка без параметров, а не сбой всей
	// ленты: колонки (текст, медиа, время) у неё остаются.
	if len(paramsRaw) > 0 {
		_ = json.Unmarshal(paramsRaw, &m.Params)
	}
	if len(webPageRaw) > 0 && string(webPageRaw) != "null" {
		var wp domain.WebPagePreview
		if json.Unmarshal(webPageRaw, &wp) == nil {
			m.WebPage = &wp
		}
	}
	return m, nil
}

// paramsParam — jsonb строкой (см. entitiesParam): []byte pgx закодировал бы как bytea.
func paramsParam(p domain.ScheduledParams) (string, error) {
	b, err := json.Marshal(p)
	return string(b), err
}

func (r *ScheduledRepo) Create(ctx context.Context, m domain.ScheduledMessage) (domain.ScheduledMessage, bool, error) {
	params, err := paramsParam(m.Params)
	if err != nil {
		return domain.ScheduledMessage{}, false, err
	}
	out, err := scanScheduled(querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO scheduled_messages (chat_id, sender_id, type, text, entities, reply_to_id, media_id, send_at, when_online, repeat_period, client_msg_id, params)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		 ON CONFLICT (chat_id, sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL DO NOTHING
		 RETURNING `+scheduledCols,
		m.ChatID, m.SenderID, m.Type, m.Text, entitiesParam(m.Entities), m.ReplyToID, m.MediaID, m.SendAt, m.WhenOnline,
		m.RepeatPeriod, m.ClientMsgID, params))
	if err == nil {
		return out, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) || m.ClientMsgID == nil {
		return domain.ScheduledMessage{}, false, err
	}
	// Конфликт по ключу идемпотентности — отдаём уже стоящую строку.
	out, err = r.ByClientMsgID(ctx, m.ChatID, m.SenderID, *m.ClientMsgID)
	return out, false, err
}

// ListByChat — СВОИ отложенные в чате, ближайшие сверху.
func (r *ScheduledRepo) ListByChat(ctx context.Context, chatID, senderID int64) ([]domain.ScheduledMessage, error) {
	return r.query(ctx,
		`SELECT `+scheduledCols+` FROM scheduled_messages
		  WHERE chat_id=$1 AND sender_id=$2 ORDER BY send_at, id`, chatID, senderID)
}

// CountByChat — отложенных у автора в чате (лимит 100 на чат).
func (r *ScheduledRepo) CountByChat(ctx context.Context, chatID, senderID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM scheduled_messages WHERE chat_id=$1 AND sender_id=$2`, chatID, senderID).Scan(&n)
	return n, err
}

func (r *ScheduledRepo) ByID(ctx context.Context, id int64) (domain.ScheduledMessage, error) {
	m, err := scanScheduled(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+scheduledCols+` FROM scheduled_messages WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ScheduledMessage{}, domain.ErrNotFound
	}
	return m, err
}

func (r *ScheduledRepo) ByClientMsgID(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.ScheduledMessage, error) {
	m, err := scanScheduled(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+scheduledCols+` FROM scheduled_messages WHERE chat_id=$1 AND sender_id=$2 AND client_msg_id=$3`,
		chatID, senderID, clientMsgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ScheduledMessage{}, domain.ErrNotFound
	}
	return m, err
}

func (r *ScheduledRepo) ByIDs(ctx context.Context, chatID, senderID int64, ids []int64) ([]domain.ScheduledMessage, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return r.query(ctx,
		`SELECT `+scheduledCols+` FROM scheduled_messages
		  WHERE chat_id=$1 AND sender_id=$2 AND id = ANY($3) ORDER BY id`, chatID, senderID, ids)
}

func (r *ScheduledRepo) ByGroupedID(ctx context.Context, chatID, senderID, groupedID int64) ([]domain.ScheduledMessage, error) {
	return r.query(ctx,
		`SELECT `+scheduledCols+` FROM scheduled_messages
		  WHERE chat_id=$1 AND sender_id=$2 AND (params->>'grouped_id')::bigint = $3 ORDER BY id`,
		chatID, senderID, groupedID)
}

func (r *ScheduledRepo) DeleteIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`DELETE FROM scheduled_messages WHERE id = ANY($1) RETURNING id`, ids)
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

// Due — созревшие по времени к отправке (для фонового воркера). Записи с
// when_online сюда не попадают: они ждут собеседника, а не времени.
func (r *ScheduledRepo) Due(ctx context.Context, now time.Time, limit int) ([]domain.ScheduledMessage, error) {
	return r.query(ctx,
		`SELECT `+scheduledCols+` FROM scheduled_messages
		  WHERE when_online = false AND send_at <= $1 ORDER BY send_at, id LIMIT $2`, now, limit)
}

// WhenOnlineWaits — пары «чат + автор + собеседник лички» с ожидающими «когда
// в сети». Каждая пара проверяется на каждом тике: окна, в котором старые
// ожидания офлайн-собеседников заслоняли бы остальные, больше нет (НО-2).
func (r *ScheduledRepo) WhenOnlineWaits(ctx context.Context) ([]usecasechat.ScheduledWait, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT DISTINCT s.chat_id, s.sender_id, cm.user_id
		   FROM scheduled_messages s
		   JOIN chats c ON c.id = s.chat_id AND c.type = 'private'
		   JOIN chat_members cm ON cm.chat_id = s.chat_id AND cm.user_id <> s.sender_id
		  WHERE s.when_online`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []usecasechat.ScheduledWait
	for rows.Next() {
		var w usecasechat.ScheduledWait
		if e := rows.Scan(&w.ChatID, &w.SenderID, &w.PeerID); e != nil {
			return nil, e
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (r *ScheduledRepo) WhenOnlineIn(ctx context.Context, chatID, senderID int64) ([]domain.ScheduledMessage, error) {
	return r.query(ctx,
		`SELECT `+scheduledCols+` FROM scheduled_messages
		  WHERE chat_id=$1 AND sender_id=$2 AND when_online ORDER BY id`, chatID, senderID)
}

func (r *ScheduledRepo) Update(ctx context.Context, m domain.ScheduledMessage) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE scheduled_messages SET text=$2, entities=$3, send_at=$4, when_online=$5, repeat_period=$6 WHERE id=$1`,
		m.ID, m.Text, entitiesParam(m.Entities), m.SendAt, m.WhenOnline, m.RepeatPeriod)
	return err
}

// SetWebPage пишет превью ссылки отложенного; картинка дублируется в колонку
// web_page_media_id, как у messages (миграция 0092).
func (r *ScheduledRepo) SetWebPage(ctx context.Context, id int64, wp *domain.WebPagePreview) error {
	var param, photoID any
	if wp != nil {
		b, err := json.Marshal(wp)
		if err != nil {
			return err
		}
		param = string(b)
		if wp.PhotoID > 0 {
			photoID = wp.PhotoID
		}
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE scheduled_messages SET web_page=$2, web_page_media_id=$3 WHERE id=$1`, id, param, photoID)
	return err
}

func (r *ScheduledRepo) query(ctx context.Context, sql string, args ...any) ([]domain.ScheduledMessage, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ScheduledMessage
	for rows.Next() {
		m, e := scanScheduled(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
