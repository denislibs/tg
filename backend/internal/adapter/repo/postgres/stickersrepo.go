package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasestickers "github.com/messenger-denis/backend/internal/usecase/stickers"
)

// StickersRepo — postgres-реализация порта stickers.Repo (наборы, стикеры,
// установка, recent/faved, saved_gifs).
type StickersRepo struct{ pool *pgxpool.Pool }

var _ usecasestickers.Repo = (*StickersRepo)(nil)

func NewStickersRepo(pool *pgxpool.Pool) *StickersRepo { return &StickersRepo{pool: pool} }

// setCols — колонки набора + число стикеров (для клиентских превью наборов).
const setCols = `s.id, s.slug, s.title, s.kind, COALESCE(s.created_by, 0),
	(SELECT count(*) FROM stickers st WHERE st.set_id = s.id)`

func scanSet(s scanner) (domain.StickerSet, error) {
	var set domain.StickerSet
	err := s.Scan(&set.ID, &set.Slug, &set.Title, &set.Kind, &set.CreatedBy, &set.StickerCount)
	return set, err
}

func (r *StickersRepo) CreateSet(ctx context.Context, set domain.StickerSet) (domain.StickerSet, error) {
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO sticker_sets (slug, title, kind, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
		set.Slug, set.Title, set.Kind, set.CreatedBy).Scan(&set.ID)
	if isUniqueViolation(err) {
		return domain.StickerSet{}, domain.ErrConflict
	}
	return set, err
}

func (r *StickersRepo) SetBySlug(ctx context.Context, slug string) (domain.StickerSet, error) {
	set, err := scanSet(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+setCols+` FROM sticker_sets s WHERE s.slug=$1`, slug))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.StickerSet{}, domain.ErrNotFound
	}
	return set, err
}

func (r *StickersRepo) SetByID(ctx context.Context, id int64) (domain.StickerSet, error) {
	set, err := scanSet(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+setCols+` FROM sticker_sets s WHERE s.id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.StickerSet{}, domain.ErrNotFound
	}
	return set, err
}

const stickerCols = `st.id, st.set_id, st.media_id, st.emoji, st.position`

func scanStickers(rows pgx.Rows) ([]domain.Sticker, error) {
	defer rows.Close()
	var out []domain.Sticker
	for rows.Next() {
		var s domain.Sticker
		if err := rows.Scan(&s.ID, &s.SetID, &s.MediaID, &s.Emoji, &s.Position); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *StickersRepo) Stickers(ctx context.Context, setID int64) ([]domain.Sticker, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+stickerCols+` FROM stickers st WHERE st.set_id=$1 ORDER BY st.position, st.id`, setID)
	if err != nil {
		return nil, err
	}
	return scanStickers(rows)
}

func (r *StickersRepo) AddSticker(ctx context.Context, s domain.Sticker) (domain.Sticker, error) {
	// position — следующий в наборе (сид и пополнение идут последовательно).
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO stickers (set_id, media_id, emoji, position)
		 VALUES ($1,$2,$3, COALESCE((SELECT max(position)+1 FROM stickers WHERE set_id=$1), 0))
		 RETURNING id, position`,
		s.SetID, s.MediaID, s.Emoji).Scan(&s.ID, &s.Position)
	return s, err
}

func (r *StickersRepo) StickerByID(ctx context.Context, id int64) (domain.Sticker, error) {
	var s domain.Sticker
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+stickerCols+` FROM stickers st WHERE st.id=$1`, id).
		Scan(&s.ID, &s.SetID, &s.MediaID, &s.Emoji, &s.Position)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Sticker{}, domain.ErrNotFound
	}
	return s, err
}

func (r *StickersRepo) Install(ctx context.Context, userID, setID int64) error {
	// Новый набор встаёт в конец списка; повторная установка — no-op.
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO user_sticker_sets (user_id, set_id, position)
		 VALUES ($1,$2, COALESCE((SELECT max(position)+1 FROM user_sticker_sets WHERE user_id=$1), 0))
		 ON CONFLICT (user_id, set_id) DO NOTHING`, userID, setID)
	return err
}

func (r *StickersRepo) Uninstall(ctx context.Context, userID, setID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM user_sticker_sets WHERE user_id=$1 AND set_id=$2`, userID, setID)
	return err
}

func (r *StickersRepo) InstalledSets(ctx context.Context, userID int64) ([]domain.StickerSet, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+setCols+`
		   FROM user_sticker_sets uss
		   JOIN sticker_sets s ON s.id = uss.set_id
		  WHERE uss.user_id=$1
		  ORDER BY uss.position, uss.added_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StickerSet
	for rows.Next() {
		set, e := scanSet(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, set)
	}
	return out, rows.Err()
}

func (r *StickersRepo) SearchSets(ctx context.Context, q string, limit int) ([]domain.StickerSet, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+setCols+`
		   FROM sticker_sets s
		  WHERE s.title ILIKE '%' || $1 || '%' OR s.slug ILIKE '%' || $1 || '%'
		  ORDER BY s.id
		  LIMIT $2`, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StickerSet
	for rows.Next() {
		set, e := scanSet(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, set)
	}
	return out, rows.Err()
}

func (r *StickersRepo) TouchRecent(ctx context.Context, userID, stickerID int64, keep int) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`INSERT INTO recent_stickers (user_id, sticker_id) VALUES ($1,$2)
		 ON CONFLICT (user_id, sticker_id) DO UPDATE SET used_at = now()`, userID, stickerID); err != nil {
		return err
	}
	// Обрезка хвоста: остаются keep самых свежих (tweb RECENT_STICKERS_COUNT).
	_, err := q.Exec(ctx,
		`DELETE FROM recent_stickers
		  WHERE user_id=$1 AND sticker_id NOT IN (
		        SELECT sticker_id FROM recent_stickers
		         WHERE user_id=$1 ORDER BY used_at DESC, sticker_id DESC LIMIT $2)`, userID, keep)
	return err
}

func (r *StickersRepo) Recent(ctx context.Context, userID int64, limit int) ([]domain.Sticker, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+stickerCols+`
		   FROM recent_stickers rs
		   JOIN stickers st ON st.id = rs.sticker_id
		  WHERE rs.user_id=$1
		  ORDER BY rs.used_at DESC, rs.sticker_id DESC
		  LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	return scanStickers(rows)
}

func (r *StickersRepo) Fave(ctx context.Context, userID, stickerID int64, keep int) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`INSERT INTO faved_stickers (user_id, sticker_id) VALUES ($1,$2)
		 ON CONFLICT (user_id, sticker_id) DO UPDATE SET faved_at = now()`, userID, stickerID); err != nil {
		return err
	}
	_, err := q.Exec(ctx,
		`DELETE FROM faved_stickers
		  WHERE user_id=$1 AND sticker_id NOT IN (
		        SELECT sticker_id FROM faved_stickers
		         WHERE user_id=$1 ORDER BY faved_at DESC, sticker_id DESC LIMIT $2)`, userID, keep)
	return err
}

func (r *StickersRepo) Unfave(ctx context.Context, userID, stickerID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM faved_stickers WHERE user_id=$1 AND sticker_id=$2`, userID, stickerID)
	return err
}

func (r *StickersRepo) Faved(ctx context.Context, userID int64, limit int) ([]domain.Sticker, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+stickerCols+`
		   FROM faved_stickers fs
		   JOIN stickers st ON st.id = fs.sticker_id
		  WHERE fs.user_id=$1
		  ORDER BY fs.faved_at DESC, fs.sticker_id DESC
		  LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	return scanStickers(rows)
}

func (r *StickersRepo) SearchByEmoji(ctx context.Context, userID int64, emoji string, limit int) ([]domain.Sticker, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+stickerCols+`
		   FROM stickers st
		   JOIN user_sticker_sets uss ON uss.set_id = st.set_id AND uss.user_id=$1
		  WHERE st.emoji=$2
		  ORDER BY uss.position, st.position, st.id
		  LIMIT $3`, userID, emoji, limit)
	if err != nil {
		return nil, err
	}
	return scanStickers(rows)
}

func (r *StickersRepo) SavedGifs(ctx context.Context, userID int64) ([]domain.SavedGif, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT media_id, saved_at FROM saved_gifs WHERE user_id=$1 ORDER BY saved_at DESC, media_id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.SavedGif
	for rows.Next() {
		var g domain.SavedGif
		if e := rows.Scan(&g.MediaID, &g.SavedAt); e != nil {
			return nil, e
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *StickersRepo) SaveGif(ctx context.Context, userID, mediaID int64, keep int) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`INSERT INTO saved_gifs (user_id, media_id) VALUES ($1,$2)
		 ON CONFLICT (user_id, media_id) DO UPDATE SET saved_at = now()`, userID, mediaID); err != nil {
		return err
	}
	// LIFO-обрезка: остаются keep последних сохранённых.
	_, err := q.Exec(ctx,
		`DELETE FROM saved_gifs
		  WHERE user_id=$1 AND media_id NOT IN (
		        SELECT media_id FROM saved_gifs
		         WHERE user_id=$1 ORDER BY saved_at DESC, media_id DESC LIMIT $2)`, userID, keep)
	return err
}

func (r *StickersRepo) DeleteGif(ctx context.Context, userID, mediaID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM saved_gifs WHERE user_id=$1 AND media_id=$2`, userID, mediaID)
	return err
}

func (r *StickersRepo) MediaExists(ctx context.Context, mediaID int64) (bool, error) {
	var ok bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM media WHERE id=$1)`, mediaID).Scan(&ok)
	return ok, err
}

func (r *StickersRepo) IsStickerMedia(ctx context.Context, mediaID int64) (bool, error) {
	var ok bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM stickers WHERE media_id=$1)`, mediaID).Scan(&ok)
	return ok, err
}
