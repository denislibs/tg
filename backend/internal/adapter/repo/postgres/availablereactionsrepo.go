package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// AvailableReactionsRepo — хранилище каталога доступных реакций
// (available_reactions, Telegram messages.getAvailableReactions). Не путать с
// ReactionsRepo: тот хранит реакции пользователей на конкретных сообщениях, а
// этот — общий для всех справочник эмодзи-реакций с их файлами-ролями.
type AvailableReactionsRepo struct{ pool *pgxpool.Pool }

func NewAvailableReactionsRepo(pool *pgxpool.Pool) *AvailableReactionsRepo {
	return &AvailableReactionsRepo{pool: pool}
}

// availableReactionCols — колонки каталога; COALESCE(...,0) по всем ролям,
// т.к. Telegram отдаёт не все роли для каждой реакции (0 — файла для роли нет).
const availableReactionCols = `emoji, title, position, premium, inactive,
	COALESCE(static_media_id,0), COALESCE(appear_media_id,0), COALESCE(select_media_id,0),
	COALESCE(activate_media_id,0), COALESCE(effect_media_id,0), COALESCE(around_media_id,0),
	COALESCE(center_media_id,0)`

func scanAvailableReaction(s scanner) (domain.AvailableReaction, error) {
	var r domain.AvailableReaction
	err := s.Scan(&r.Emoji, &r.Title, &r.Position, &r.Premium, &r.Inactive,
		&r.StaticMediaID, &r.AppearMediaID, &r.SelectMediaID, &r.ActivateMediaID,
		&r.EffectMediaID, &r.AroundMediaID, &r.CenterMediaID)
	return r, err
}

// List отдаёт реакции в порядке position — это порядок пикера реакций в
// Telegram, у клиента нет своих данных, чтобы его переставить.
func (r *AvailableReactionsRepo) List(ctx context.Context) ([]domain.AvailableReaction, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+availableReactionCols+` FROM available_reactions ORDER BY position, emoji`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.AvailableReaction
	for rows.Next() {
		rc, err := scanAvailableReaction(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}

// Upsert заливает/обновляет реакцию (зовёт сид). NULLIF($n,0) превращает
// отсутствующую роль (0 — своим нулевым значением int64, не файлом) в NULL:
// повторный прогон сида с урезанным набором ролей корректно стирает старые
// ссылки, а не оставляет их висеть на уже неактуальных media.
func (r *AvailableReactionsRepo) Upsert(ctx context.Context, rc domain.AvailableReaction) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO available_reactions
		   (emoji, title, position, premium, inactive,
		    static_media_id, appear_media_id, select_media_id, activate_media_id,
		    effect_media_id, around_media_id, center_media_id)
		 VALUES ($1,$2,$3,$4,$5, NULLIF($6,0), NULLIF($7,0), NULLIF($8,0), NULLIF($9,0),
		         NULLIF($10,0), NULLIF($11,0), NULLIF($12,0))
		 ON CONFLICT (emoji) DO UPDATE SET
		   title             = EXCLUDED.title,
		   position          = EXCLUDED.position,
		   premium           = EXCLUDED.premium,
		   inactive          = EXCLUDED.inactive,
		   static_media_id   = EXCLUDED.static_media_id,
		   appear_media_id   = EXCLUDED.appear_media_id,
		   select_media_id   = EXCLUDED.select_media_id,
		   activate_media_id = EXCLUDED.activate_media_id,
		   effect_media_id   = EXCLUDED.effect_media_id,
		   around_media_id   = EXCLUDED.around_media_id,
		   center_media_id   = EXCLUDED.center_media_id`,
		rc.Emoji, rc.Title, rc.Position, rc.Premium, rc.Inactive,
		rc.StaticMediaID, rc.AppearMediaID, rc.SelectMediaID, rc.ActivateMediaID,
		rc.EffectMediaID, rc.AroundMediaID, rc.CenterMediaID)
	return err
}
