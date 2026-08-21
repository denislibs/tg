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
func (r *MediaAccessRepo) DimsByIDs(ctx context.Context, ids []int64) (map[int64]usecasechat.MediaDims, error) {
	out := make(map[int64]usecasechat.MediaDims, len(ids))
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
		var d usecasechat.MediaDims
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

// CanAccess reports whether userID may download a media object. Access is granted if any holds:
//   - they own it;
//   - the media is the photo of a chat they are a member of;
//   - they are a member of a chat that has a message referencing it — either as
//     the message's own media, or as the picture of its link preview
//     (messages.web_page_media_id, миграция 0092);
//   - the media backs an active story they may view — i.e. they authored it, or
//     they are a chat partner of the author and the story is 'everyone'/'contacts',
//     or the story is 'selected' and they are on its allowlist.
//
// The story branch mirrors the visibility predicate used by the stories feed
// (see StoryRepo.ActiveFeed) so a viewer who can see a story can fetch its media.
func (r *MediaAccessRepo) CanAccess(ctx context.Context, userID, mediaID int64) (bool, error) {
	q := querier(ctx, r.pool)
	var allowed bool
	err := q.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM media WHERE id=$1 AND owner_id=$2
		   UNION ALL
		   -- avatars are visible to any authenticated user (the media id is some
		   -- user's current avatar)
		   SELECT 1 FROM users WHERE avatar_media_id = $1
		   UNION ALL
		   -- chat photos are visible to that chat's members
		   SELECT 1 FROM chats c
		     JOIN chat_members cm ON cm.chat_id = c.id
		     WHERE c.photo_media_id=$1 AND cm.user_id=$2
		   UNION ALL
		   SELECT 1 FROM messages m
		     JOIN chat_members cm ON cm.chat_id = m.chat_id
		     WHERE m.media_id=$1 AND cm.user_id=$2
		   UNION ALL
		   -- картинка превью ссылки: скачана нами, владелец — отправитель, но
		   -- видеть её должны все участники чата
		   SELECT 1 FROM messages m
		     JOIN chat_members cm ON cm.chat_id = m.chat_id
		     WHERE m.web_page_media_id=$1 AND cm.user_id=$2
		   UNION ALL
		   SELECT 1 FROM stories s
		     WHERE s.media_id=$1 AND s.expires_at > now()
		       AND (
		         s.author_id = $2
		         OR (
		           EXISTS(
		             SELECT 1 FROM chat_members cm1
		               JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id = s.author_id
		             WHERE cm1.user_id = $2
		           )
		           AND (
		             s.privacy IN ('everyone','contacts')
		             OR EXISTS(SELECT 1 FROM story_allow sa WHERE sa.story_id = s.id AND sa.user_id = $2)
		           )
		         )
		       )
		 )`, mediaID, userID).Scan(&allowed)
	return allowed, err
}
