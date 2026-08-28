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
	(SELECT count(*) FROM stickers st WHERE st.set_id = s.id), s.rank, COALESCE(s.cover_media_id, 0)`

// setColsInstalled — те же колонки плюс СРОК УСТАНОВКИ: на проводе это
// `stickerSet.installed_date`, параметр самого набора (Р2 разбора стикеров).
// Отдельная константа, а не подзапрос в setCols: «установлен ли» — вопрос про
// пару «пользователь + набор», и выборки без пользователя (тренды, поиск) на
// него не отвечают вовсе.
const setColsInstalled = setCols + `, uss.added_at`

func scanSet(s scanner) (domain.StickerSetRecord, error) {
	var set domain.StickerSetRecord
	err := s.Scan(&set.ID, &set.Slug, &set.Title, &set.Kind, &set.CreatedBy, &set.StickerCount,
		&set.Rank, &set.CoverMediaID)
	return set, err
}

func scanSetInstalled(s scanner) (domain.StickerSetRecord, error) {
	var set domain.StickerSetRecord
	err := s.Scan(&set.ID, &set.Slug, &set.Title, &set.Kind, &set.CreatedBy, &set.StickerCount,
		&set.Rank, &set.CoverMediaID, &set.InstalledAt)
	return set, err
}

func (r *StickersRepo) CreateSet(ctx context.Context, set domain.StickerSetRecord) (domain.StickerSetRecord, error) {
	// NULLIF(.., 0): CreatedBy — zero value доменной структуры для «набора без
	// владельца» (created_by в схеме NULLABLE), а не ссылка на реального
	// пользователя с id=0 — такого не существует, INSERT литерального 0 уронил
	// бы FK sticker_sets_created_by_fkey.
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO sticker_sets (slug, title, kind, created_by) VALUES ($1,$2,$3,NULLIF($4,0)) RETURNING id`,
		set.Slug, set.Title, set.Kind, set.CreatedBy).Scan(&set.ID)
	if isUniqueViolation(err) {
		return domain.StickerSetRecord{}, domain.ErrConflict
	}
	return set, err
}

// SetRank проставляет набору позицию в трендах. Зовётся сидом: только он
// знает порядок выдачи messages.getFeaturedStickers.
func (r *StickersRepo) SetRank(ctx context.Context, setID int64, rank int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE sticker_sets SET rank = $2 WHERE id = $1`, setID, rank)
	return err
}

// SetCover привязывает медиа обложки к набору.
func (r *StickersRepo) SetCover(ctx context.Context, setID, mediaID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE sticker_sets SET cover_media_id = $2 WHERE id = $1`, setID, mediaID)
	return err
}

// StickerPositions отдаёт занятые позиции набора: по ним сид (cmd/seed-stickers)
// понимает, каких стикеров в наборе ещё нет, и заливает только недостающие, не
// трогая существующие — на них ссылаются уже отправленные сообщения.
func (r *StickersRepo) StickerPositions(ctx context.Context, setID int64) (map[int]struct{}, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT position FROM stickers WHERE set_id = $1`, setID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]struct{}{}
	for rows.Next() {
		var pos int
		if err := rows.Scan(&pos); err != nil {
			return nil, err
		}
		out[pos] = struct{}{}
	}
	return out, rows.Err()
}

func (r *StickersRepo) SetBySlug(ctx context.Context, slug string) (domain.StickerSetRecord, error) {
	set, err := scanSet(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+setCols+` FROM sticker_sets s WHERE s.slug=$1`, slug))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.StickerSetRecord{}, domain.ErrNotFound
	}
	return set, err
}

func (r *StickersRepo) SetByID(ctx context.Context, id int64) (domain.StickerSetRecord, error) {
	set, err := scanSet(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+setCols+` FROM sticker_sets s WHERE s.id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.StickerSetRecord{}, domain.ErrNotFound
	}
	return set, err
}

// stickerCols — колонки стикера + метаданные его файла из media. Размеры, mime и
// stripped-превью нужны клиенту ДО загрузки байтов (пропорция бокса, выбор
// рендерера, нижний слой показа) — см. domain.Sticker.
const stickerCols = `st.id, st.set_id, st.media_id, st.emoji, st.position,
	COALESCE(m.width, 0), COALESCE(m.height, 0), COALESCE(m.mime, ''), COALESCE(m.size, 0),
	m.blur_preview, st.path_thumb`

// stickerRowCols — те же колонки СТРОКИ стикера без префикса таблицы: нужны
// подзапросу stickerByMediaJoin, где таблица ещё не получила псевдоним st.
const stickerRowCols = `id, set_id, media_id, emoji, position, path_thumb`

// stickerMediaJoin — INNER JOIN безопасен: stickers.media_id NOT NULL и
// ссылается на media(id), строк не теряем.
const stickerMediaJoin = ` JOIN media m ON m.id = st.media_id`

func scanSticker(s scanner) (domain.Sticker, error) {
	var st domain.Sticker
	err := s.Scan(&st.ID, &st.SetID, &st.MediaID, &st.Emoji, &st.Position,
		&st.Width, &st.Height, &st.Mime, &st.Size, &st.Thumb, &st.PathThumb)
	return st, err
}

func scanStickers(rows pgx.Rows) ([]domain.Sticker, error) {
	defer rows.Close()
	var out []domain.Sticker
	for rows.Next() {
		s, err := scanSticker(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *StickersRepo) Stickers(ctx context.Context, setID int64) ([]domain.Sticker, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+stickerCols+` FROM stickers st`+stickerMediaJoin+
			` WHERE st.set_id=$1 ORDER BY st.position, st.id`, setID)
	if err != nil {
		return nil, err
	}
	return scanStickers(rows)
}

// CoverStickers — превью первых perSet стикеров каждого набора из setIDs,
// ОДНИМ запросом на всю выдачу (аналог covered sets Telegram messages.
// getFeaturedStickers: набор едет вместе с первыми документами). Экран поиска
// показывает разом сотни наборов — по одному SetBySlug на строку это N+1,
// здесь вместо цикла оконная функция row_number() OVER (PARTITION BY set_id).
// Порядок внутри набора — тот же, что у Stickers: position, id.
func (r *StickersRepo) CoverStickers(ctx context.Context, setIDs []int64, perSet int) (map[int64][]domain.Sticker, error) {
	if len(setIDs) == 0 {
		return map[int64][]domain.Sticker{}, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+stickerCols+` FROM (
		   SELECT st.*, row_number() OVER (PARTITION BY st.set_id ORDER BY st.position, st.id) AS rn
		     FROM stickers st WHERE st.set_id = ANY($1)
		 ) st`+stickerMediaJoin+`
		 WHERE rn <= $2
		 ORDER BY st.set_id, st.position, st.id`, setIDs, perSet)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]domain.Sticker{}
	for rows.Next() {
		s, err := scanSticker(rows)
		if err != nil {
			return nil, err
		}
		out[s.SetID] = append(out[s.SetID], s)
	}
	return out, rows.Err()
}

func (r *StickersRepo) AddSticker(ctx context.Context, s domain.Sticker) (domain.Sticker, error) {
	// position — следующий в наборе (сид и пополнение идут последовательно).
	// Вставку заворачиваем в CTE и дочитываем media тем же джойном, что и
	// остальные выборки: добавленный стикер уезжает клиенту сразу, и метаданные
	// файла у него должны быть те же, что и после перезагрузки набора.
	return scanSticker(querier(ctx, r.pool).QueryRow(ctx,
		`WITH ins AS (
		   INSERT INTO stickers (set_id, media_id, emoji, position)
		   VALUES ($1,$2,$3, COALESCE((SELECT max(position)+1 FROM stickers WHERE set_id=$1), 0))
		   RETURNING id, set_id, media_id, emoji, position, path_thumb
		 )
		 SELECT `+stickerCols+` FROM ins st`+stickerMediaJoin,
		s.SetID, s.MediaID, s.Emoji))
}

// AddStickerAt добавляет стикер на явную позицию (в отличие от AddSticker,
// который всегда аппендит в конец через max(position)+1). Нужен сиду
// (cmd/seed-stickers): при досидировании недостающих позиций существующего
// набора позиция берётся из meta.json, а не назначается хранилищем — если в
// середине набора есть дыра (стикер удалили), max+1 промахивается мимо дыры
// и уезжает в хвост, из-за чего повторный прогон сида находит ту же дыру
// «недостающей» снова и плодит дубль на каждом запуске.
//
// pathThumb — контур стикера (см. domain.Sticker.PathThumb), едет вместе со
// вставкой: он известен сиду сразу из meta.json, отдельный проход не нужен.
func (r *StickersRepo) AddStickerAt(ctx context.Context, setID, mediaID int64, emoji string, position int, pathThumb []byte) (domain.Sticker, error) {
	return scanSticker(querier(ctx, r.pool).QueryRow(ctx,
		`WITH ins AS (
		   INSERT INTO stickers (set_id, media_id, emoji, position, path_thumb)
		   VALUES ($1,$2,$3,$4,$5)
		   RETURNING id, set_id, media_id, emoji, position, path_thumb
		 )
		 SELECT `+stickerCols+` FROM ins st`+stickerMediaJoin,
		setID, mediaID, emoji, position, pathThumb))
}

// BackfillPathThumbs дозаписывает контур уже существующим стикерам набора —
// по позиции, одним запросом. Нужен сиду: стикеры могли быть залиты раньше
// появления этого поля (на стенде — уже 13.5к штук без контура), а
// AddStickerAt/fillMissingStickers трогают только позиции, которых в наборе
// ещё нет. Уже проставленный контур не перезаписываем (WHERE path_thumb IS
// NULL) — сид гоняется при каждом деплое, и без этого условия каждый прогон
// впустую переписывал бы все строки набора.
func (r *StickersRepo) BackfillPathThumbs(ctx context.Context, setID int64, thumbs map[int][]byte) error {
	if len(thumbs) == 0 {
		return nil
	}
	positions := make([]int64, 0, len(thumbs))
	data := make([][]byte, 0, len(thumbs))
	for pos, thumb := range thumbs {
		positions = append(positions, int64(pos))
		data = append(data, thumb)
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE stickers st
		    SET path_thumb = v.thumb
		   FROM unnest($2::bigint[], $3::bytea[]) AS v(position, thumb)
		  WHERE st.set_id = $1 AND st.position = v.position AND st.path_thumb IS NULL`,
		setID, positions, data)
	return err
}

// StickerByMediaID — стикер по КЛЮЧУ ФАЙЛА (document.id схемы). Прежде здесь
// был StickerByID — поиск по суррогатному ключу строки, который наружу больше
// не выходит (Р2).
//
// `ORDER BY st.id LIMIT 1` осознанный, а не защита от неожиданности: один и
// тот же файл может числиться в двух наборах, уникального индекса по media_id
// нет. Вызывающему (проверка «существует ли такой стикер» перед fave/use)
// достаточно любой строки — сам ответ от выбора не зависит.
func (r *StickersRepo) StickerByMediaID(ctx context.Context, mediaID int64) (domain.Sticker, error) {
	s, err := scanSticker(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+stickerCols+` FROM stickers st`+stickerMediaJoin+`
		  WHERE st.media_id=$1 ORDER BY st.id LIMIT 1`, mediaID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Sticker{}, domain.ErrNotFound
	}
	return s, err
}

// stickerByMediaJoin — одна строка набора на файл, для списков, ключованных
// файлом (недавние, избранное). LATERAL, а не обычный JOIN: обычный размножил
// бы запись на число наборов, где файл числится, и в панели появился бы дубль —
// ровно тот дефект, который снял переход на ключ файла.
const stickerByMediaJoin = ` JOIN LATERAL (
			SELECT ` + stickerRowCols + ` FROM stickers WHERE media_id = f.media_id ORDER BY id LIMIT 1
		) st ON TRUE`

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

func (r *StickersRepo) InstalledSets(ctx context.Context, userID int64) ([]domain.StickerSetRecord, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+setColsInstalled+`
		   FROM user_sticker_sets uss
		   JOIN sticker_sets s ON s.id = uss.set_id
		  WHERE uss.user_id=$1
		  ORDER BY uss.position, uss.added_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StickerSetRecord
	for rows.Next() {
		set, e := scanSetInstalled(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, set)
	}
	return out, rows.Err()
}

func (r *StickersRepo) SearchSets(ctx context.Context, q string, limit int) ([]domain.StickerSetRecord, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+setCols+`
		   FROM sticker_sets s
		  WHERE s.title ILIKE '%' || $1 || '%' OR s.slug ILIKE '%' || $1 || '%'
		  ORDER BY s.id
		  LIMIT $2`, escapeLike(q), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StickerSetRecord
	for rows.Next() {
		set, e := scanSet(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, set)
	}
	return out, rows.Err()
}

// FeaturedSets — «трендовые» наборы: сначала по rank (1,2,3… — порядок
// messages.getFeaturedStickers из Telegram), затем наборы без ранга (rank=0)
// новейшими первыми.
func (r *StickersRepo) FeaturedSets(ctx context.Context, limit int) ([]domain.StickerSetRecord, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+setCols+`
		   FROM sticker_sets s
		  ORDER BY (s.rank = 0), s.rank, s.id DESC
		  LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StickerSetRecord
	for rows.Next() {
		set, e := scanSet(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, set)
	}
	return out, rows.Err()
}

func (r *StickersRepo) TouchRecent(ctx context.Context, userID, mediaID int64, keep int) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`INSERT INTO recent_stickers (user_id, media_id) VALUES ($1,$2)
		 ON CONFLICT (user_id, media_id) DO UPDATE SET used_at = now()`, userID, mediaID); err != nil {
		return err
	}
	// Обрезка хвоста: остаются keep самых свежих (tweb RECENT_STICKERS_COUNT).
	_, err := q.Exec(ctx,
		`DELETE FROM recent_stickers
		  WHERE user_id=$1 AND media_id NOT IN (
		        SELECT media_id FROM recent_stickers
		         WHERE user_id=$1 ORDER BY used_at DESC, media_id DESC LIMIT $2)`, userID, keep)
	return err
}

// ClearRecent — стереть весь список недавних пользователя (кнопка «очистить»
// в заголовке Recent эмодзи-дропдауна, tweb clearRecentStickers).
func (r *StickersRepo) ClearRecent(ctx context.Context, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM recent_stickers WHERE user_id=$1`, userID)
	return err
}

func (r *StickersRepo) Recent(ctx context.Context, userID int64, limit int) ([]domain.RecentSticker, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+stickerCols+`, f.used_at
		   FROM recent_stickers f`+stickerByMediaJoin+stickerMediaJoin+`
		  WHERE f.user_id=$1
		  ORDER BY f.used_at DESC, f.media_id DESC
		  LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.RecentSticker
	for rows.Next() {
		var rec domain.RecentSticker
		if e := rows.Scan(&rec.ID, &rec.SetID, &rec.MediaID, &rec.Emoji, &rec.Position,
			&rec.Width, &rec.Height, &rec.Mime, &rec.Size, &rec.Thumb, &rec.PathThumb, &rec.UsedAt); e != nil {
			return nil, e
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (r *StickersRepo) Fave(ctx context.Context, userID, mediaID int64, keep int) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx,
		`INSERT INTO faved_stickers (user_id, media_id) VALUES ($1,$2)
		 ON CONFLICT (user_id, media_id) DO UPDATE SET faved_at = now()`, userID, mediaID); err != nil {
		return err
	}
	_, err := q.Exec(ctx,
		`DELETE FROM faved_stickers
		  WHERE user_id=$1 AND media_id NOT IN (
		        SELECT media_id FROM faved_stickers
		         WHERE user_id=$1 ORDER BY faved_at DESC, media_id DESC LIMIT $2)`, userID, keep)
	return err
}

func (r *StickersRepo) Unfave(ctx context.Context, userID, mediaID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM faved_stickers WHERE user_id=$1 AND media_id=$2`, userID, mediaID)
	return err
}

func (r *StickersRepo) Faved(ctx context.Context, userID int64, limit int) ([]domain.Sticker, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+stickerCols+`
		   FROM faved_stickers f`+stickerByMediaJoin+stickerMediaJoin+`
		  WHERE f.user_id=$1
		  ORDER BY f.faved_at DESC, f.media_id DESC
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
		   JOIN user_sticker_sets uss ON uss.set_id = st.set_id AND uss.user_id=$1`+stickerMediaJoin+`
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
		`SELECT g.media_id, g.saved_at, COALESCE(m.width,0), COALESCE(m.height,0),
		        COALESCE(m.mime,''), COALESCE(m.size,0), m.blur_preview, COALESCE(m.animated,FALSE)
		   FROM saved_gifs g JOIN media m ON m.id = g.media_id
		  WHERE g.user_id=$1 ORDER BY g.saved_at DESC, g.media_id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.SavedGif
	for rows.Next() {
		var g domain.SavedGif
		if e := rows.Scan(&g.MediaID, &g.SavedAt, &g.Width, &g.Height,
			&g.Mime, &g.Size, &g.Blur, &g.Animated); e != nil {
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
