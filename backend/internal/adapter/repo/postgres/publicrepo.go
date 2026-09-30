package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasepublic "github.com/messenger-denis/backend/internal/usecase/public"
)

// PublicRepo — чтение для анонимных страниц-превью (аналог t.me): username
// (сначала пользователи, затем группы/каналы с публичным именем),
// ссылка-приглашение, набор стикеров, пост публичного канала.
type PublicRepo struct{ pool *pgxpool.Pool }

func NewPublicRepo(pool *pgxpool.Pool) *PublicRepo { return &PublicRepo{pool: pool} }

var _ usecasepublic.Repo = (*PublicRepo)(nil)

func (r *PublicRepo) Resolve(ctx context.Context, username string) (domain.PublicProfile, error) {
	q := querier(ctx, r.pool)

	// Публичная страница анонимна: bio и фото показываются только при
	// privacy-правиле everybody (отсутствие строки = дефолт everybody).
	// Заголовок публичной страницы — единственное место, где сервер сам
	// склеивает имя: страницу читает АНОНИМ, у которого кэша пиров нет вовсе,
	// и собрать «Имя Фамилия» на клиенте некому.
	var p domain.PublicProfile
	var avatarMediaID *int64
	var isBot bool
	err := q.QueryRow(ctx,
		`SELECT btrim(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')),
		        CASE WHEN COALESCE(pra.value,'everybody')='everybody' THEN COALESCE(u.bio,'') ELSE '' END,
		        CASE WHEN COALESCE(prp.value,'everybody')='everybody' THEN u.avatar_media_id END,
		        u.is_verified, u.is_bot
		   FROM users u
		   LEFT JOIN privacy_rules pra ON pra.user_id = u.id AND pra.key = 'about'
		   LEFT JOIN privacy_rules prp ON prp.user_id = u.id AND prp.key = 'profile_photo'
		  WHERE u.username = $1 AND NOT u.is_service AND u.deleted_at IS NULL`, username).
		Scan(&p.Title, &p.About, &avatarMediaID, &p.Verified, &isBot)
	if err == nil {
		p.Kind = "user"
		if isBot {
			p.Kind = "bot"
		}
		p.Username = username
		if avatarMediaID != nil {
			p.AvatarMediaID = *avatarMediaID
		}
		return p, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domain.PublicProfile{}, err
	}

	var photoMediaID *int64
	err = q.QueryRow(ctx,
		`SELECT type, title, COALESCE(about,''), photo_media_id, member_count
		   FROM chats WHERE username = $1 AND is_public`, username).
		Scan(&p.Kind, &p.Title, &p.About, &photoMediaID, &p.MemberCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PublicProfile{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.PublicProfile{}, err
	}
	p.Username = username
	if photoMediaID != nil {
		p.AvatarMediaID = *photoMediaID
	}
	return p, nil
}

func (r *PublicRepo) Invite(ctx context.Context, token string) (domain.InviteLink, domain.PublicInvite, error) {
	var l domain.InviteLink
	var inv domain.PublicInvite
	var photoMediaID *int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT il.revoked, il.expires_at, il.usage_limit, il.uses,
		        c.type, c.title, COALESCE(c.about,''), c.photo_media_id, c.member_count
		   FROM invite_links il JOIN chats c ON c.id = il.chat_id
		  WHERE il.token = $1 AND c.type IN ('group','channel')`, token).
		Scan(&l.Revoked, &l.ExpiresAt, &l.UsageLimit, &l.Uses,
			&inv.Kind, &inv.Title, &inv.About, &photoMediaID, &inv.MemberCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.InviteLink{}, domain.PublicInvite{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.InviteLink{}, domain.PublicInvite{}, err
	}
	l.Token = token
	if photoMediaID != nil {
		inv.AvatarMediaID = *photoMediaID
	}
	return l, inv, nil
}

// StickerSet — короткое имя без учёта регистра, как у t.me/addstickers.
func (r *PublicRepo) StickerSet(ctx context.Context, shortName string) (domain.PublicStickerSet, error) {
	var s domain.PublicStickerSet
	var kind string
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT slug, title, kind FROM sticker_sets WHERE lower(slug) = lower($1)`, shortName).
		Scan(&s.ShortName, &s.Title, &kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PublicStickerSet{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.PublicStickerSet{}, err
	}
	s.Emoji = kind == "emoji"
	return s, nil
}

// Post — сообщение публичного канала. Картинка — только у фото без спойлера
// и только image/* (превью на анонимной странице).
func (r *PublicRepo) Post(ctx context.Context, username string, seq int64) (domain.PublicPost, error) {
	var p domain.PublicPost
	var photoMediaID, mediaID *int64
	var mediaW, mediaH *int
	var entitiesRaw []byte
	var createdAt time.Time
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT c.username::text, c.title, COALESCE(c.about,''), c.photo_media_id, c.member_count,
		        m.text, m.entities, m.views, m.created_at, md.id, md.width, md.height
		   FROM chats c
		   JOIN messages m ON m.chat_id = c.id AND m.seq = $2
		        AND m.deleted_at IS NULL AND m.type <> 'service'
		   LEFT JOIN media md ON md.id = m.media_id AND m.type = 'photo'
		        AND NOT m.media_spoiler AND md.mime LIKE 'image/%'
		  WHERE c.username = $1 AND c.is_public AND c.type = 'channel'`, username, seq).
		Scan(&p.Channel.Username, &p.Channel.Title, &p.Channel.About, &photoMediaID, &p.Channel.MemberCount,
			&p.Text, &entitiesRaw, &p.Views, &createdAt, &mediaID, &mediaW, &mediaH)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PublicPost{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.PublicPost{}, err
	}
	p.Channel.Kind = "channel"
	p.Seq = seq
	p.CreatedAt = createdAt
	if photoMediaID != nil {
		p.Channel.AvatarMediaID = *photoMediaID
	}
	if mediaID != nil {
		p.MediaID = *mediaID
		p.MediaW, p.MediaH = *mediaW, *mediaH
	}
	if len(entitiesRaw) > 0 && string(entitiesRaw) != "null" {
		_ = json.Unmarshal(entitiesRaw, &p.Entities)
	}
	return p, nil
}
