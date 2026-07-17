package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// DraftsRepo реализует chat.DraftRepo поверх таблицы drafts.
type DraftsRepo struct{ pool *pgxpool.Pool }

func NewDraftsRepo(pool *pgxpool.Pool) *DraftsRepo { return &DraftsRepo{pool: pool} }

var _ usecasechat.DraftRepo = (*DraftsRepo)(nil)

const draftCols = `chat_id, text, entities, reply_to_id, updated_at`

func scanDraft(row pgx.Row) (domain.Draft, error) {
	var d domain.Draft
	var entRaw []byte
	if err := row.Scan(&d.ChatID, &d.Text, &entRaw, &d.ReplyToID, &d.UpdatedAt); err != nil {
		return domain.Draft{}, err
	}
	if len(entRaw) > 0 {
		_ = json.Unmarshal(entRaw, &d.Entities)
	}
	return d, nil
}

func (r *DraftsRepo) Upsert(ctx context.Context, userID int64, d domain.Draft) (domain.Draft, error) {
	return scanDraft(querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO drafts (chat_id, user_id, text, entities, reply_to_id, updated_at)
		 VALUES ($1, $2, $3, $4, $5, now())
		 ON CONFLICT (chat_id, user_id)
		 DO UPDATE SET text=$3, entities=$4, reply_to_id=$5, updated_at=now()
		 RETURNING `+draftCols,
		d.ChatID, userID, d.Text, entitiesParam(d.Entities), d.ReplyToID))
}

func (r *DraftsRepo) Delete(ctx context.Context, chatID, userID int64) (bool, error) {
	tag, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM drafts WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (r *DraftsRepo) ListByUser(ctx context.Context, userID int64) ([]domain.Draft, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+draftCols+` FROM drafts WHERE user_id=$1 ORDER BY updated_at DESC`, userID)
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

func (r *DraftsRepo) DeleteAllByUser(ctx context.Context, userID int64) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`DELETE FROM drafts WHERE user_id=$1 RETURNING chat_id`, userID)
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
