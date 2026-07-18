package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// ScheduledRepo хранит очередь запланированных сообщений.
type ScheduledRepo struct {
	pool *pgxpool.Pool
}

func NewScheduledRepo(pool *pgxpool.Pool) *ScheduledRepo { return &ScheduledRepo{pool: pool} }

const scheduledCols = `id, chat_id, sender_id, type, text, entities, reply_to_id, media_id, send_at, created_at`

func scanScheduled(s scanner) (domain.ScheduledMessage, error) {
	var m domain.ScheduledMessage
	var entitiesRaw []byte
	err := s.Scan(&m.ID, &m.ChatID, &m.SenderID, &m.Type, &m.Text, &entitiesRaw, &m.ReplyToID, &m.MediaID, &m.SendAt, &m.CreatedAt)
	if err == nil && len(entitiesRaw) > 0 && string(entitiesRaw) != "null" {
		_ = json.Unmarshal(entitiesRaw, &m.Entities)
	}
	return m, err
}

func (r *ScheduledRepo) Create(ctx context.Context, m domain.ScheduledMessage) (domain.ScheduledMessage, error) {
	return scanScheduled(querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO scheduled_messages (chat_id, sender_id, type, text, entities, reply_to_id, media_id, send_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING `+scheduledCols,
		m.ChatID, m.SenderID, m.Type, m.Text, entitiesParam(m.Entities), m.ReplyToID, m.MediaID, m.SendAt))
}

// ListByChat — СВОИ запланированные в чате, ближайшие сверху.
func (r *ScheduledRepo) ListByChat(ctx context.Context, chatID, senderID int64) ([]domain.ScheduledMessage, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+scheduledCols+` FROM scheduled_messages
		  WHERE chat_id=$1 AND sender_id=$2 ORDER BY send_at ASC`, chatID, senderID)
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

// CountByUser — сколько всего запланировал пользователь (лимит как в Telegram).
func (r *ScheduledRepo) CountByUser(ctx context.Context, senderID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM scheduled_messages WHERE sender_id=$1`, senderID).Scan(&n)
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

func (r *ScheduledRepo) Delete(ctx context.Context, id int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `DELETE FROM scheduled_messages WHERE id=$1`, id)
	return err
}

// Due — созревшие к отправке (для фонового воркера).
func (r *ScheduledRepo) Due(ctx context.Context, now time.Time, limit int) ([]domain.ScheduledMessage, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+scheduledCols+` FROM scheduled_messages WHERE send_at <= $1 ORDER BY send_at LIMIT $2`, now, limit)
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
