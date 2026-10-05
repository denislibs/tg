package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// MediaAccessRepo is a postgres-backed adapter implementing the chat usecase's MediaAccessRepo port.
type MediaAccessRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.MediaAccessRepo = (*MediaAccessRepo)(nil)

func NewMediaAccessRepo(pool *pgxpool.Pool) *MediaAccessRepo { return &MediaAccessRepo{pool: pool} }

// DimsByIDs batch-loads width/height/mime for the given media ids in one query.
func (r *MediaAccessRepo) DimsByIDs(ctx context.Context, ids []int64) (map[int64]domain.MediaSource, error) {
	out := make(map[int64]domain.MediaSource, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	q := querier(ctx, r.pool)
	// blur_preview и waveform — bytea (сканируются в []byte; NULL → nil). COALESCE the
	// nullable text columns so a NULL doesn't fail a scan into a Go string.
	//
	// Контур стикера (path_thumb) живёт не в media, а в строке стикера — это
	// метаданные набора, а не отдельный файл, — поэтому приезжает LEFT JOIN'ом
	// тем же батчем: в модели сообщения он всего лишь ещё одна ступень thumbs
	// (photoPathSize), и без джойна до сообщения не доезжает вовсе.
	rows, err := q.Query(ctx, `SELECT m.id, COALESCE(m.width,0), COALESCE(m.height,0), COALESCE(m.mime,''),
		m.blur_preview, COALESCE(m.thumb_key,''), COALESCE(m.duration,0), COALESCE(m.size,0), COALESCE(m.file_name,''),
		COALESCE(m.title,''), COALESCE(m.performer,''), COALESCE(m.animated,FALSE), m.waveform, s.path_thumb, COALESCE(s.emoji,''), COALESCE(s.set_id,0)
		FROM media m
		LEFT JOIN LATERAL (
			SELECT path_thumb, emoji, set_id FROM stickers WHERE media_id = m.id ORDER BY (path_thumb IS NULL), id LIMIT 1
		) s ON TRUE
		WHERE m.id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var d domain.MediaSource
		var thumbKey string
		if e := rows.Scan(&id, &d.Width, &d.Height, &d.Mime, &d.Blur, &thumbKey, &d.Duration, &d.Size, &d.FileName,
			&d.Title, &d.Performer, &d.Animated, &d.Waveform, &d.PathThumb, &d.StickerAlt, &d.StickerSetID); e != nil {
			return nil, e
		}
		d.HasThumb = thumbKey != ""
		out[id] = d
	}
	return out, rows.Err()
}

// OwnerID returns the owner of a media object, or domain.ErrNotFound if absent.
func (r *MediaAccessRepo) OwnerID(ctx context.Context, mediaID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var ownerID int64
	err := q.QueryRow(ctx, `SELECT owner_id FROM media WHERE id=$1`, mediaID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return ownerID, err
}

// CanAccess reports whether userID may download a media object: КТО ВИДИТ
// ИСТОЧНИК, ТОТ И КАЧАЕТ. Предикаты источников — те же, что у их выдач
// (visibility.go), а не свои копии:
//   - свой файл;
//   - фото чата, который зритель читает (участник либо публичный, не бан);
//   - вложение или картинка превью ссылки (messages.web_page_media_id,
//     миграция 0092) сообщения, которое зритель видит в читаемом чате
//     (messageVisibleTo: удалённое, скрытое у себя, очищенное и скрытая
//     предыстория не качаются);
//   - медиа истории, которую зритель видит (storyVisibleTo — то же правило, что
//     у ленты, просмотра и закреплённых профиля): живой либо закреплённой.
//
// Аватарки здесь нет: их видимость решает правило приватности владельца
// (profile_photo + блок), а оно живёт в usecase — см. AvatarOwners.
func (r *MediaAccessRepo) CanAccess(ctx context.Context, userID, mediaID int64) (bool, error) {
	q := querier(ctx, r.pool)
	var allowed bool
	err := q.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM media WHERE id=$1 AND owner_id=$2
		   UNION ALL
		   SELECT 1 FROM chats c
		     WHERE c.photo_media_id=$1 AND `+chatReadableBy("c.id", "$2")+`
		   UNION ALL
		   SELECT 1 FROM messages m
		     WHERE m.media_id=$1 AND `+chatReadableBy("m.chat_id", "$2")+` AND `+messageVisibleTo("m", "$2")+`
		   UNION ALL
		   SELECT 1 FROM messages m
		     WHERE m.web_page_media_id=$1 AND `+chatReadableBy("m.chat_id", "$2")+` AND `+messageVisibleTo("m", "$2")+`
		   UNION ALL
		   SELECT 1 FROM stories s
		     WHERE s.media_id=$1 AND (s.expires_at > now() OR s.pinned)
		       AND `+storyVisibleTo("s", "$2")+`
		 )`, mediaID, userID).Scan(&allowed)
	return allowed, err
}

// AvatarOwners — пользователи, у которых этот файл — фото профиля: текущая
// аватарка или снимок галереи (с видео-вариантом). Скачать его можно тому,
// кому правило profile_photo владельца разрешает фото видеть (решает usecase).
func (r *MediaAccessRepo) AvatarOwners(ctx context.Context, mediaID int64) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id FROM users WHERE avatar_media_id = $1
		 UNION
		 SELECT user_id FROM profile_photos WHERE media_id = $1 OR video_media_id = $1`, mediaID)
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
