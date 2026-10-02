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
// member_count), user discovery by username/display_name prefix, the «own»
// split of those hits (OwnPeers), and
// case-insensitive @username resolution for join-by-username. The username
// column is citext, so ILIKE and equality are already case-insensitive. Like the
// sibling repos every query runs through querier(ctx, pool).
type SearchRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.SearchRepo = (*SearchRepo)(nil)

func NewSearchRepo(pool *pgxpool.Pool) *SearchRepo { return &SearchRepo{pool: pool} }

func (r *SearchRepo) SearchChats(ctx context.Context, q string, limit int) ([]domain.ChatRecord, error) {
	like := escapeLike(q) + "%"
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT c.id, c.type, c.title, COALESCE(c.username,''), c.about, c.member_count,
		        c.photo_media_id, pm.blur_preview
		   FROM chats c LEFT JOIN media pm ON pm.id = c.photo_media_id
		  WHERE c.is_public = true AND (c.username ILIKE $1 OR c.title ILIKE $2)
		  ORDER BY c.member_count DESC LIMIT $3`, like, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ChatRecord
	for rows.Next() {
		var c domain.ChatRecord
		if err := rows.Scan(&c.ID, &c.Type, &c.Title, &c.Username, &c.About, &c.MemberCount, &c.PhotoID, &c.PhotoPreview); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SearchUsers — пользователи по @username/имени профиля, карточки глазами
// viewerID (userSeenCols).
func (r *SearchRepo) SearchUsers(ctx context.Context, viewerID int64, q string, limit int) ([]domain.UserReal, error) {
	like := escapeLike(q) + "%"
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+userSeenCols("u.", "$4")+`
		   FROM users u WHERE u.username ILIKE $1 OR u.display_name ILIKE $2 LIMIT $3`, like, like, limit, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.UserReal
	for rows.Next() {
		u, err := scanUserSeen(rows)
		if err != nil {
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
func (r *SearchRepo) SimilarChannels(ctx context.Context, chatID, viewerID int64, limit int) ([]domain.ChatRecord, int, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT c.id, c.type, c.title, COALESCE(c.username,''), c.about, c.member_count,
		        c.photo_media_id, pm.blur_preview, c.created_at, count(*) OVER() AS total
		   FROM chat_members m
		   JOIN chats c ON c.id = m.chat_id
		   LEFT JOIN media pm ON pm.id = c.photo_media_id
		  WHERE m.user_id IN (SELECT user_id FROM chat_members WHERE chat_id = $1)
		    AND m.chat_id <> $1
		    AND c.type = 'channel'
		    AND c.is_public = true
		    AND NOT EXISTS (SELECT 1 FROM chat_members me WHERE me.chat_id = c.id AND me.user_id = $2)
		  GROUP BY c.id, pm.blur_preview, c.created_at
		  ORDER BY count(DISTINCT m.user_id) DESC, c.member_count DESC
		  LIMIT $3`, chatID, viewerID, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []domain.ChatRecord
	total := 0
	for rows.Next() {
		var c domain.ChatRecord
		var t int
		if err := rows.Scan(&c.ID, &c.Type, &c.Title, &c.Username, &c.About, &c.MemberCount, &c.PhotoID, &c.PhotoPreview, &c.CreatedAt, &t); err != nil {
			return nil, 0, err
		}
		// Зритель здесь ЕСТЬ, и он по построению выборки (NOT EXISTS выше) не
		// состоит ни в одном из этих каналов. Отсюда два следствия краткой
		// формы: pFlags.left выставлен, а channel.date — дата создания, как
		// схема и предписывает для не-участника (ChatRecord.ChannelDate).
		c.ViewerID = viewerID
		total = t
		out = append(out, c)
	}
	return out, total, rows.Err()
}

// OwnPeers делит попадания поиска пиров на «свои» (my_results contacts.search):
// чаты, где viewerID участник, и пользователи из его контактов или с общим
// личным чатом. Один запрос на всю выдачу — три ветки UNION по индексам:
// PK chat_members (chat_id, user_id), PK contacts (owner_id, user_id) и
// idx_chat_members_user для личных чатов зрителя.
func (r *SearchRepo) OwnPeers(ctx context.Context, viewerID int64, chatIDs, userIDs []int64) (map[int64]bool, map[int64]bool, error) {
	chats, users := map[int64]bool{}, map[int64]bool{}
	if len(chatIDs) == 0 && len(userIDs) == 0 {
		return chats, users, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT true, cm.chat_id FROM chat_members cm
		  WHERE cm.user_id = $1 AND cm.chat_id = ANY($2)
		 UNION
		 SELECT false, ct.user_id FROM contacts ct
		  WHERE ct.owner_id = $1 AND ct.user_id = ANY($3)
		 UNION
		 SELECT false, other.user_id FROM chat_members me
		   JOIN chats c ON c.id = me.chat_id AND c.type = 'private'
		   JOIN chat_members other ON other.chat_id = me.chat_id AND other.user_id <> $1
		  WHERE me.user_id = $1 AND other.user_id = ANY($3)`,
		viewerID, chatIDs, userIDs)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var isChat bool
		var id int64
		if err := rows.Scan(&isChat, &id); err != nil {
			return nil, nil, err
		}
		if isChat {
			chats[id] = true
		} else {
			users[id] = true
		}
	}
	return chats, users, rows.Err()
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
