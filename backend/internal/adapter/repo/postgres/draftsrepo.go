package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// DraftsRepo реализует chat.DraftRepo поверх таблицы drafts.
//
// Ключ черновика — (chat_id, user_id, thread_root_id), миграция 0173: у tweb
// черновик лежит на паре «пир + тред» (appDraftsManager.ts:88-90).
type DraftsRepo struct{ pool *pgxpool.Pool }

func NewDraftsRepo(pool *pgxpool.Pool) *DraftsRepo { return &DraftsRepo{pool: pool} }

var _ usecasechat.DraftRepo = (*DraftsRepo)(nil)

// draftTopMsgID — номер треда черновика снаружи (updateDraftMessage.top_msg_id)
// из ключа строки: корень треда — его номер в чате; ключ 0 в форуме — General
// (domain.GeneralTopicID), вне форума — черновик чата (0). Выводится при
// чтении, а не хранится: включение и выключение тем меняет смысл ключа 0.
//
// Ожидает алиасы d (drafts), c (chats), r (корень, LEFT JOIN по
// draftRootJoin).
const draftTopMsgID = `CASE WHEN d.thread_root_id = 0 THEN CASE WHEN c.is_forum THEN 1 ELSE 0 END ELSE r.seq END`

const draftRootJoin = ` JOIN chats c ON c.id = d.chat_id
	LEFT JOIN messages r ON d.thread_root_id <> 0 AND r.id = d.thread_root_id`

// draftLive — черновик треда, корня которого больше нет, не выдаётся: номер
// треда ему не вывести.
const draftLive = `(d.thread_root_id = 0 OR r.id IS NOT NULL)`

const draftCols = `d.chat_id, d.thread_root_id, ` + draftTopMsgID + `, d.text, d.entities, d.reply_to_id, d.updated_at`

func scanDraft(row pgx.Row) (domain.Draft, error) {
	var d domain.Draft
	var entRaw []byte
	var top *int64
	if err := row.Scan(&d.ChatID, &d.ThreadRootID, &top, &d.Text, &entRaw, &d.ReplyToID, &d.UpdatedAt); err != nil {
		return domain.Draft{}, err
	}
	if top != nil {
		d.TopMsgID = *top
	}
	if len(entRaw) > 0 {
		_ = json.Unmarshal(entRaw, &d.Entities)
	}
	return d, nil
}

func (r *DraftsRepo) Upsert(ctx context.Context, userID int64, d domain.Draft) (domain.Draft, error) {
	return scanDraft(querier(ctx, r.pool).QueryRow(ctx,
		`WITH d AS (
		   INSERT INTO drafts (chat_id, user_id, thread_root_id, text, entities, reply_to_id, updated_at)
		   VALUES ($1, $2, $3, $4, $5, $6, now())
		   ON CONFLICT (chat_id, user_id, thread_root_id)
		   DO UPDATE SET text=$4, entities=$5, reply_to_id=$6, updated_at=now()
		   RETURNING *)
		 SELECT `+draftCols+` FROM d`+draftRootJoin,
		d.ChatID, userID, d.ThreadRootID, d.Text, entitiesParam(d.Entities), d.ReplyToID))
}

func (r *DraftsRepo) Delete(ctx context.Context, chatID, userID, threadRootID int64) (int64, bool, error) {
	var top *int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`WITH d AS (
		   DELETE FROM drafts WHERE chat_id=$1 AND user_id=$2 AND thread_root_id=$3
		   RETURNING chat_id, thread_root_id)
		 SELECT `+draftTopMsgID+` FROM d`+draftRootJoin,
		chatID, userID, threadRootID).Scan(&top)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	if top == nil {
		// Корня треда нет — черновик не выдавался (draftLive), и снимать
		// его на устройствах нечего.
		return 0, false, nil
	}
	return *top, true, nil
}

func (r *DraftsRepo) ListByUser(ctx context.Context, userID int64) ([]domain.Draft, error) {
	return r.list(ctx, `d.user_id=$1`, userID)
}

func (r *DraftsRepo) ListByChat(ctx context.Context, userID, chatID int64) ([]domain.Draft, error) {
	return r.list(ctx, `d.user_id=$1 AND d.chat_id=$2`, userID, chatID)
}

func (r *DraftsRepo) list(ctx context.Context, where string, args ...any) ([]domain.Draft, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+draftCols+` FROM drafts d`+draftRootJoin+`
		 WHERE `+where+` AND `+draftLive+` ORDER BY d.updated_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Draft
	for rows.Next() {
		d, err := scanDraft(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *DraftsRepo) DeleteAllByUser(ctx context.Context, userID int64) ([]domain.Draft, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`WITH d AS (
		   DELETE FROM drafts WHERE user_id=$1 RETURNING chat_id, thread_root_id)
		 SELECT d.chat_id, d.thread_root_id, `+draftTopMsgID+` FROM d`+draftRootJoin+`
		 WHERE `+draftLive, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Draft
	for rows.Next() {
		var d domain.Draft
		var top *int64
		if err := rows.Scan(&d.ChatID, &d.ThreadRootID, &top); err != nil {
			return nil, err
		}
		if top != nil {
			d.TopMsgID = *top
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
