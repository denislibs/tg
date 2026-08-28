package postgres

import (
	"context"
	"errors"

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

func (r *PublicRepo) Resolve(ctx context.Context, username string) (domain.PublicProfile, error) {
	q := querier(ctx, r.pool)

	// Публичная страница анонимна: bio и фото показываются только при
	// privacy-правиле everybody (отсутствие строки = дефолт everybody).
	// Заголовок публичной страницы — единственное место, где сервер сам
	// склеивает имя: страницу читает АНОНИМ, у которого кэша пиров нет вовсе,
	// и собрать «Имя Фамилия» на клиенте некому.
	var p domain.PublicProfile
	var avatarMediaID *int64
	err := q.QueryRow(ctx,
		`SELECT btrim(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')),
		        CASE WHEN COALESCE(pra.value,'everybody')='everybody' THEN COALESCE(u.bio,'') ELSE '' END,
		        CASE WHEN COALESCE(prp.value,'everybody')='everybody' THEN u.avatar_media_id END,
		        u.is_verified
		   FROM users u
		   LEFT JOIN privacy_rules pra ON pra.user_id = u.id AND pra.key = 'about'
		   LEFT JOIN privacy_rules prp ON prp.user_id = u.id AND prp.key = 'profile_photo'
		  WHERE u.username = $1 AND NOT u.is_service`, username).
		Scan(&p.Title, &p.About, &avatarMediaID, &p.Verified)
	if err == nil {
		p.Kind = "user"
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
