package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// LivestreamRepo персистит метаданные RTMP-трансляций (таблица livestreams):
// одна строка на чат, ключ chat_id.
type LivestreamRepo struct {
	pool *pgxpool.Pool
}

func NewLivestreamRepo(pool *pgxpool.Pool) *LivestreamRepo { return &LivestreamRepo{pool: pool} }

// Get возвращает трансляцию чата; domain.ErrNotFound, если её ещё не заводили.
func (r *LivestreamRepo) Get(ctx context.Context, chatID int64) (domain.Livestream, error) {
	var ls domain.Livestream
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT chat_id, stream_key, active, started_at FROM livestreams WHERE chat_id=$1`,
		chatID).Scan(&ls.ChatID, &ls.StreamKey, &ls.Active, &ls.StartedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Livestream{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Livestream{}, err
	}
	return ls, nil
}

// Upsert создаёт или обновляет строку трансляции целиком.
func (r *LivestreamRepo) Upsert(ctx context.Context, ls domain.Livestream) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO livestreams (chat_id, stream_key, active, started_at) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (chat_id) DO UPDATE SET stream_key=$2, active=$3, started_at=$4`,
		ls.ChatID, ls.StreamKey, ls.Active, ls.StartedAt)
	return err
}
