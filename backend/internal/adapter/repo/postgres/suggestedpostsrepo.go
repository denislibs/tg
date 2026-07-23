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

// SuggestedPostsRepo хранит предложенные в канал посты (таблица suggested_posts).
type SuggestedPostsRepo struct {
	pool *pgxpool.Pool
}

func NewSuggestedPostsRepo(pool *pgxpool.Pool) *SuggestedPostsRepo {
	return &SuggestedPostsRepo{pool: pool}
}

var _ usecasechat.SuggestedPostRepo = (*SuggestedPostsRepo)(nil)

const suggestedPostCols = `id, chat_id, author_id, text, entities, media_id, publish_at, status, created_at, decided_by, decided_at`

func scanSuggestedPost(s scanner) (domain.SuggestedPost, error) {
	var sp domain.SuggestedPost
	var entitiesRaw []byte
	err := s.Scan(&sp.ID, &sp.ChatID, &sp.AuthorID, &sp.Text, &entitiesRaw, &sp.MediaID,
		&sp.PublishAt, &sp.Status, &sp.CreatedAt, &sp.DecidedBy, &sp.DecidedAt)
	if err == nil && len(entitiesRaw) > 0 && string(entitiesRaw) != "null" {
		_ = json.Unmarshal(entitiesRaw, &sp.Entities)
	}
	return sp, err
}

func (r *SuggestedPostsRepo) Create(ctx context.Context, sp domain.SuggestedPost) (domain.SuggestedPost, error) {
	status := sp.Status
	if status == "" {
		status = "pending"
	}
	return scanSuggestedPost(querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO suggested_posts (chat_id, author_id, text, entities, media_id, publish_at, status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING `+suggestedPostCols,
		sp.ChatID, sp.AuthorID, sp.Text, entitiesParam(sp.Entities), sp.MediaID, sp.PublishAt, status))
}

func (r *SuggestedPostsRepo) ByID(ctx context.Context, id int64) (domain.SuggestedPost, error) {
	sp, err := scanSuggestedPost(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+suggestedPostCols+` FROM suggested_posts WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.SuggestedPost{}, domain.ErrNotFound
	}
	return sp, err
}

func (r *SuggestedPostsRepo) ListPending(ctx context.Context, chatID int64) ([]domain.SuggestedPost, error) {
	return r.list(ctx,
		`SELECT `+suggestedPostCols+` FROM suggested_posts
		  WHERE chat_id=$1 AND status='pending' ORDER BY created_at DESC, id DESC`, chatID)
}

func (r *SuggestedPostsRepo) ListByAuthor(ctx context.Context, chatID, authorID int64) ([]domain.SuggestedPost, error) {
	return r.list(ctx,
		`SELECT `+suggestedPostCols+` FROM suggested_posts
		  WHERE chat_id=$1 AND author_id=$2 ORDER BY created_at DESC, id DESC`, chatID, authorID)
}

func (r *SuggestedPostsRepo) list(ctx context.Context, sql string, args ...any) ([]domain.SuggestedPost, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.SuggestedPost
	for rows.Next() {
		sp, e := scanSuggestedPost(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, sp)
	}
	return out, rows.Err()
}

// Decide атомарно решает pending-пост: только строка со status='pending'
// обновляется (гонка двух админов — второй получит ErrNotFound).
func (r *SuggestedPostsRepo) Decide(ctx context.Context, id int64, status string, decidedBy int64, publishAt *time.Time) (domain.SuggestedPost, error) {
	sp, err := scanSuggestedPost(querier(ctx, r.pool).QueryRow(ctx,
		`UPDATE suggested_posts
		    SET status=$2, decided_by=$3, decided_at=now(), publish_at=$4
		  WHERE id=$1 AND status='pending'
		 RETURNING `+suggestedPostCols, id, status, decidedBy, publishAt))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.SuggestedPost{}, domain.ErrNotFound
	}
	return sp, err
}

func (r *SuggestedPostsRepo) MarkPublished(ctx context.Context, id int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE suggested_posts SET publish_at=NULL WHERE id=$1`, id)
	return err
}

func (r *SuggestedPostsRepo) DuePublish(ctx context.Context, now time.Time, limit int) ([]domain.SuggestedPost, error) {
	return r.list(ctx,
		`SELECT `+suggestedPostCols+` FROM suggested_posts
		  WHERE status='approved' AND publish_at IS NOT NULL AND publish_at <= $1
		  ORDER BY publish_at LIMIT $2`, now, limit)
}
