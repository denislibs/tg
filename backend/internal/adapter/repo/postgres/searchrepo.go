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
// member_count), user discovery by username/display_name/contact-book name prefix, the «own»
// split of those hits (OwnPeers), and
// case-insensitive @username resolution for join-by-username. The username
// column is citext, so ILIKE and equality are already case-insensitive. Like the
// sibling repos every query runs through querier(ctx, pool).
type SearchRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.SearchRepo = (*SearchRepo)(nil)

func NewSearchRepo(pool *pgxpool.Pool) *SearchRepo { return &SearchRepo{pool: pool} }

// SearchChats — публичные чаты по префиксу @username/названия, по убыванию
// числа участников. Только id: карточки собирает общий сборщик
// (GroupRepo.Cards) глазами зрителя.
func (r *SearchRepo) SearchChats(ctx context.Context, q string, limit int) ([]int64, error) {
	like := escapeLike(q) + "%"
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT c.id FROM chats c
		  WHERE c.is_public = true AND (c.username ILIKE $1 OR c.title ILIKE $2)
		  ORDER BY c.member_count DESC LIMIT $3`, like, like, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[int64])
}

// SearchUsers — пользователи по префиксу для contacts.search; карточки глазами
// viewerID (userSeenCols). По @username ищется среди ВСЕХ, по имени — только
// среди СВОИХ (контакты зрителя ∪ собеседники по личке без скрытого диалога):
// иначе имя было бы вектором перебора людей (Ф7-Е, MC-14, решение В-8; tweb
// отдаёт чужих отдельным вектором `results`, appUsersManager.ts:1182-1214).
//
// Живой контакт находится по имени из книги зрителя (имя, фамилия, «имя
// фамилия» — так он видит человека в списке, SeenBy) и по профильному; удалённый
// аккаунт имени из книги не получает («Deleted Account»), поэтому по книге не
// ищется. Собеседник по личке — по профильному. Совпадение — префикс СТРОКИ
// (имя, фамилия или «имя фамилия» целиком), а не любого слова, как в локальном
// индексе клиента (searchIndex.ts): серверный путь добирает то, чего нет в
// загруженных контактах и диалогах.
//
// Два запроса с ORDER BY вместо одного OR: выдача детерминирована, а чужие по
// @username не вытесняют своих из limit. Свои сортируются и отсекаются по
// ВИДИМОМУ зрителю имени (книга, иначе профиль). Множество «своих» (то же
// правило, что ветки пользователей в OwnPeers — менять вместе) материализуется
// в массив и берётся по users_pkey: форма `IN (подзапрос)` и JOIN users
// планировщик разворачивал в Seq Scan по users и chat_members. Слияние — «свои
// по имени» первыми, затем по @username, без повторов, всего не больше limit.
func (r *SearchRepo) SearchUsers(ctx context.Context, viewerID int64, q string, limit int) ([]domain.UserReal, error) {
	like := escapeLike(q) + "%"
	own, err := r.queryUsers(ctx,
		`SELECT `+userSeenCols("u.", "$3")+`
		   FROM users u
		   LEFT JOIN contacts vc ON vc.owner_id = $3 AND vc.user_id = u.id
		  WHERE u.id = ANY(ARRAY(
		        SELECT ct.user_id FROM contacts ct JOIN users cu ON cu.id = ct.user_id AND cu.deleted_at IS NULL
		         WHERE ct.owner_id = $3
		           AND (ct.first_name ILIKE $1 OR ct.last_name ILIKE $1
		                OR (ct.first_name || ' ' || ct.last_name) ILIKE $1)
		        UNION
		        SELECT o.user_id FROM (
		              SELECT ct.user_id FROM contacts ct WHERE ct.owner_id = $3
		              UNION
		              SELECT other.user_id FROM chat_members other
		               WHERE other.user_id <> $3 AND other.chat_id = ANY(ARRAY(
		                     SELECT me.chat_id FROM chat_members me JOIN chats c ON c.id = me.chat_id
		                      WHERE me.user_id = $3 AND NOT me.dialog_hidden AND c.type = 'private'))
		        ) o JOIN users ou ON ou.id = o.user_id
		         WHERE ou.display_name ILIKE $1))
		  ORDER BY COALESCE(NULLIF(btrim(vc.first_name || ' ' || vc.last_name), ''), u.display_name), u.id LIMIT $2`,
		like, limit, viewerID)
	if err != nil {
		return nil, err
	}
	if len(own) >= limit {
		return own, nil
	}
	// limit строк хватает: повторов среди них не больше len(own), значит новых
	// не меньше limit-len(own).
	byUsername, err := r.queryUsers(ctx,
		`SELECT `+userSeenCols("u.", "$3")+`
		   FROM users u WHERE u.username ILIKE $1
		  ORDER BY u.username, u.id LIMIT $2`, like, limit, viewerID)
	if err != nil {
		return nil, err
	}
	seen := make(map[int64]bool, len(own))
	for _, u := range own {
		seen[u.ID] = true
	}
	for _, u := range byUsername {
		if len(own) == limit {
			break
		}
		if !seen[u.ID] {
			own = append(own, u)
		}
	}
	return own, nil
}

// queryUsers собирает карточки userSeenCols из запроса с колонками userSeenCols.
func (r *SearchRepo) queryUsers(ctx context.Context, sql string, args ...any) ([]domain.UserReal, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, sql, args...)
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
// count(*) OVER() — общее число похожих каналов до применения LIMIT. Зритель по
// построению (NOT EXISTS) не состоит ни в одном из них. Только id: карточки
// собирает общий сборщик (GroupRepo.Cards).
func (r *SearchRepo) SimilarChannels(ctx context.Context, chatID, viewerID int64, limit int) ([]int64, int, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT c.id, count(*) OVER() AS total
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
	var out []int64
	total := 0
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id, &total); err != nil {
			return nil, 0, err
		}
		out = append(out, id)
	}
	return out, total, rows.Err()
}

// OwnPeers делит попадания поиска пиров на «свои» (my_results contacts.search):
// чаты, где viewerID участник, и пользователи из его контактов или с общим
// личным чатом, не скрытым зрителем (dialog_hidden). Один запрос на всю выдачу — три ветки UNION по индексам:
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
		  WHERE me.user_id = $1 AND NOT me.dialog_hidden AND other.user_id = ANY($3)`,
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

// UserIDByUsername — пользователь по точному @имени (users.username — CITEXT,
// `=` без учёта регистра и по уникальному индексу).
func (r *SearchRepo) UserIDByUsername(ctx context.Context, username string) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id FROM users WHERE username=$1`, username).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
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
