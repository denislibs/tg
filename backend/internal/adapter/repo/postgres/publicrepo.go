package postgres

import (
	"context"
	"errors"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasepublic "github.com/messenger-denis/backend/internal/usecase/public"
)

// PublicRepo резолвит username в публичную карточку: сначала пользователи,
// затем группы/каналы с публичным именем.
type PublicRepo struct{ pool *pgxpool.Pool }

func NewPublicRepo(pool *pgxpool.Pool) *PublicRepo { return &PublicRepo{pool: pool} }

var _ usecasepublic.Repo = (*PublicRepo)(nil)

// avatar_url хранится content-путём ('/media/N/content') — достаём media id
var avatarMediaRe = regexp.MustCompile(`/media/(\d+)/content`)

func (r *PublicRepo) Resolve(ctx context.Context, username string) (domain.PublicProfile, error) {
	q := querier(ctx, r.pool)

	var p domain.PublicProfile
	var avatarURL string
	err := q.QueryRow(ctx,
		`SELECT COALESCE(NULLIF(display_name,''), first_name), COALESCE(bio,''), avatar_url, is_verified
		   FROM users WHERE username = $1 AND NOT is_service`, username).
		Scan(&p.Title, &p.About, &avatarURL, &p.Verified)
	if err == nil {
		p.Kind = "user"
		p.Username = username
		if m := avatarMediaRe.FindStringSubmatch(avatarURL); m != nil {
			p.AvatarMediaID, _ = strconv.ParseInt(m[1], 10, 64)
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
