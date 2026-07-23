package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// SearchRepo is a postgres-backed adapter implementing the chat usecase's
// SearchRepo port: public-chat discovery by @username/title prefix (ordered by
// member_count), user discovery by username/display_name prefix, and
// case-insensitive @username resolution for join-by-username. The username
// column is citext, so ILIKE and equality are already case-insensitive. Like the
// sibling repos every query runs through querier(ctx, pool).
type SearchRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.SearchRepo = (*SearchRepo)(nil)

func NewSearchRepo(pool *pgxpool.Pool) *SearchRepo { return &SearchRepo{pool: pool} }

func (r *SearchRepo) SearchChats(ctx context.Context, q string, limit int) ([]domain.ChatCard, error) {
	like := q + "%"
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, type, title, COALESCE(username,''), about, member_count, is_public
		   FROM chats
		  WHERE is_public = true AND (username ILIKE $1 OR title ILIKE $2)
		  ORDER BY member_count DESC LIMIT $3`, like, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ChatCard
	for rows.Next() {
		var c domain.ChatCard
		if err := rows.Scan(&c.ID, &c.Type, &c.Title, &c.Username, &c.About, &c.MemberCount, &c.IsPublic); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *SearchRepo) SearchUsers(ctx context.Context, q string, limit int) ([]domain.UserCard, error) {
	like := q + "%"
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, COALESCE(username,''), display_name, COALESCE(avatar_url,'')
		   FROM users WHERE username ILIKE $1 OR display_name ILIKE $2 LIMIT $3`, like, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.UserCard
	for rows.Next() {
		var u domain.UserCard
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.AvatarURL); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SimilarChannels ранжирует публичные каналы по пересечению аудитории с chatID.
// Self-join chat_members: подписчики chatID → их другие подписки на публичные
// каналы, сгруппированные по каналу и упорядоченные по числу общих подписчиков
// (индекс idx_chat_members_user покрывает выборку «другие подписки юзера»).
// count(*) OVER() — общее число похожих каналов до применения LIMIT.
func (r *SearchRepo) SimilarChannels(ctx context.Context, chatID, viewerID int64, limit int) ([]domain.ChatCard, int, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT c.id, c.type, c.title, COALESCE(c.username,''), c.about, c.member_count, c.is_public,
		        count(*) OVER() AS total
		   FROM chat_members m
		   JOIN chats c ON c.id = m.chat_id
		  WHERE m.user_id IN (SELECT user_id FROM chat_members WHERE chat_id = $1)
		    AND m.chat_id <> $1
		    AND c.type = 'channel'
		    AND c.is_public = true
		    AND NOT EXISTS (SELECT 1 FROM chat_members me WHERE me.chat_id = c.id AND me.user_id = $2)
		  GROUP BY c.id
		  ORDER BY count(DISTINCT m.user_id) DESC, c.member_count DESC
		  LIMIT $3`, chatID, viewerID, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []domain.ChatCard
	total := 0
	for rows.Next() {
		var c domain.ChatCard
		var t int
		if err := rows.Scan(&c.ID, &c.Type, &c.Title, &c.Username, &c.About, &c.MemberCount, &c.IsPublic, &t); err != nil {
			return nil, 0, err
		}
		total = t
		out = append(out, c)
	}
	return out, total, rows.Err()
}

func (r *SearchRepo) PublicChatByUsername(ctx context.Context, username string) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id FROM chats WHERE username=$1 AND is_public=true`, username).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
}
