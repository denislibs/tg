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

const scheduledCols = `id, chat_id, sender_id, type, text, entities, reply_to_id, media_id, send_at, created_at, when_online, repeat_period, client_msg_id, params, web_page, attempts, occurrence, paid_stars, paid_to`

// unclaimed — строка не в аренде публикации (миграция 0169).
const unclaimed = `(claimed_until IS NULL OR claimed_until < now())`

// workerReady — вне аренды и вне отступа после сбоя (выборки воркера).
const workerReady = unclaimed + ` AND (next_attempt_at IS NULL OR next_attempt_at <= now())`

func scanScheduled(s scanner) (domain.ScheduledMessage, error) {
	var m domain.ScheduledMessage
	var entitiesRaw, paramsRaw, webPageRaw []byte
	var paidTo *int64
	err := s.Scan(&m.ID, &m.ChatID, &m.SenderID, &m.Type, &m.Text, &entitiesRaw, &m.ReplyToID, &m.MediaID,
		&m.SendAt, &m.CreatedAt, &m.WhenOnline, &m.RepeatPeriod, &m.ClientMsgID, &paramsRaw, &webPageRaw,
		&m.Attempts, &m.Occurrence, &m.PaidStars, &paidTo)
	if err != nil {
		return m, err
	}
	if paidTo != nil {
		m.PaidTo = *paidTo
	}
	if len(entitiesRaw) > 0 && string(entitiesRaw) != "null" {
		_ = json.Unmarshal(entitiesRaw, &m.Entities)
	}
	// Снимок, который не читается, — строка без параметров, а не сбой всей
	// ленты: колонки (текст, медиа, время) у неё остаются. Публикация такую
	// строку отвергает (ParamsBroken).
	if len(paramsRaw) > 0 {
		if err := json.Unmarshal(paramsRaw, &m.Params); err != nil {
			m.Params, m.ParamsBroken = domain.ScheduledParams{}, true
		}
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
		`INSERT INTO scheduled_messages (chat_id, sender_id, type, text, entities, reply_to_id, media_id, send_at, when_online, repeat_period, client_msg_id, params, paid_stars, paid_to)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULLIF($14, 0))
		 ON CONFLICT (chat_id, sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL DO NOTHING
		 RETURNING `+scheduledCols,
		m.ChatID, m.SenderID, m.Type, m.Text, entitiesParam(m.Entities), m.ReplyToID, m.MediaID, m.SendAt, m.WhenOnline,
		m.RepeatPeriod, m.ClientMsgID, params, m.PaidStars, m.PaidTo))
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

// DeleteIDs — снятие публикацией (опубликованные, отвергнутые): аренда не
// мешает, её держит сам публикатор.
func (r *ScheduledRepo) DeleteIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return r.deleteWhere(ctx, `id = ANY($1)`, ids)
}

func (r *ScheduledRepo) deleteWhere(ctx context.Context, where string, ids []int64) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`DELETE FROM scheduled_messages WHERE `+where+` RETURNING id`, ids)
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
		  WHERE when_online = false AND send_at <= $1 AND `+workerReady+` ORDER BY send_at, id LIMIT $2`, now, limit)
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
		  WHERE chat_id=$1 AND sender_id=$2 AND when_online AND `+workerReady+` ORDER BY id`, chatID, senderID)
}

// Update правит строку вне аренды публикации и только на прочитанном сроке
// (oldAt/oldWhenOnline): снятой, публикуемой или тем временем
// переставленной (повтор) — domain.ErrNotFound, кадра правки тогда быть не
// должно. Перенос срока сбрасывает попытки и отступ.
func (r *ScheduledRepo) Update(ctx context.Context, m domain.ScheduledMessage, oldAt time.Time, oldWhenOnline bool) error {
	tag, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE scheduled_messages SET text=$2, entities=$3, send_at=$4, when_online=$5, repeat_period=$6,
		        attempts = CASE WHEN send_at = $4 AND when_online = $5 THEN attempts ELSE 0 END,
		        next_attempt_at = CASE WHEN send_at = $4 AND when_online = $5 THEN next_attempt_at END
		  WHERE id=$1 AND send_at=$7 AND when_online=$8 AND `+unclaimed,
		m.ID, m.Text, entitiesParam(m.Entities), m.SendAt, m.WhenOnline, m.RepeatPeriod, oldAt, oldWhenOnline)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Claim берёт строку в аренду публикации на lease и отдаёт её свежей: только
// если она стоит на том же сроке (sendAt/whenOnline — снимок, по которому её
// выбрали; правка срока тем временем — не публиковать) и не в чужой аренде.
// countAttempt — аренда воркера считается попыткой (send_now автора — нет).
func (r *ScheduledRepo) Claim(ctx context.Context, id int64, sendAt time.Time, whenOnline bool, lease time.Duration, countAttempt bool) (domain.ScheduledMessage, bool, error) {
	m, err := scanScheduled(querier(ctx, r.pool).QueryRow(ctx,
		`UPDATE scheduled_messages SET claimed_until = now() + make_interval(secs => $4),
		        attempts = attempts + CASE WHEN $5 THEN 1 ELSE 0 END
		  WHERE id=$1 AND when_online=$3 AND (when_online OR send_at=$2) AND `+unclaimed+`
		  RETURNING `+scheduledCols, id, sendAt, whenOnline, lease.Seconds(), countAttempt))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ScheduledMessage{}, false, nil
	}
	return m, err == nil, err
}

// Release снимает аренду (строка снова в руках автора); retryAfter > 0 —
// отступ воркера до следующей попытки (после временного сбоя).
func (r *ScheduledRepo) Release(ctx context.Context, id int64, retryAfter time.Duration) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE scheduled_messages SET claimed_until = NULL,
		        next_attempt_at = CASE WHEN $2 > 0 THEN now() + make_interval(secs => $2) ELSE next_attempt_at END
		  WHERE id=$1`, id, retryAfter.Seconds())
	return err
}

// Reschedule переставляет опубликованный срок повтора from → to (тот же id),
// снимая аренду: только если строка ещё на сроке from. ok=false — строку
// тем временем сняли или перенесли, кадра быть не должно.
func (r *ScheduledRepo) Reschedule(ctx context.Context, id int64, from, to time.Time) (domain.ScheduledMessage, bool, error) {
	m, err := scanScheduled(querier(ctx, r.pool).QueryRow(ctx,
		`UPDATE scheduled_messages SET send_at=$3, claimed_until=NULL, next_attempt_at=NULL, attempts=0, occurrence=occurrence+1,
		        paid_stars=0, paid_to=NULL
		  WHERE id=$1 AND send_at=$2 AND NOT when_online
		  RETURNING `+scheduledCols, id, from, to))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ScheduledMessage{}, false, nil
	}
	return m, err == nil, err
}

// DeleteUnclaimed — снятие автором: строки в аренде публикации пропускаются
// (их снимет публикация с sent_messages).
func (r *ScheduledRepo) DeleteUnclaimed(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return r.deleteWhere(ctx, `id = ANY($1) AND `+unclaimed, ids)
}

// TakePaidByChat — удаление группы: оплаченные строки чата снимаются до
// каскада chats → scheduled_messages, чтобы вернуть звёзды.
func (r *ScheduledRepo) TakePaidByChat(ctx context.Context, chatID int64) ([]domain.ScheduledMessage, error) {
	return r.query(ctx,
		`DELETE FROM scheduled_messages WHERE chat_id=$1 AND paid_stars > 0 RETURNING `+scheduledCols, chatID)
}

// LockQueue — транзакционная блокировка очереди автора в чате: лимит 100
// считается и вставка идёт без гонки параллельных постановок.
func (r *ScheduledRepo) LockQueue(ctx context.Context, chatID, senderID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended(format('scheduled:%s:%s', $1::bigint, $2::bigint), 0))`, chatID, senderID)
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
