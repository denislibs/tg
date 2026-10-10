package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/messenger-denis/backend/internal/domain"
)

// Участники чата выборкой channels.getParticipants (Б-115): один запрос на все
// восемь фильтров схемы вместо трёх ручек (`/members`, `/bans`,
// `/restrictions`) без страниц и поиска. Порядок — как у оригинала:
// «недавние» — свежие сверху (A6-06), админы — создатель первым.

// memberCols — колонки строки членства для domain.Member (+ prefix таблицы).
// promoted_by без значения у админа читается владельцем: его вписала миграция
// 0150, а до неё он и был единственным, кто таких админов правил.
const memberCols = `m.user_id, m.role, m.rights,
	COALESCE(m.promoted_by, CASE WHEN m.role = 'admin' THEN c.creator_id END, 0),
	m.rank, COALESCE(m.inviter_id, 0), m.via_request, m.joined_at`

// activeRestriction — LEFT JOIN действующего личного ограничения участника.
const activeRestriction = `LEFT JOIN chat_restrictions r ON r.chat_id = m.chat_id AND r.user_id = m.user_id
	AND (r.until_date IS NULL OR r.until_date > now())`

func scanParticipantMember(row pgx.Row, chatID int64) (domain.Participant, error) {
	var p domain.Participant
	var rights int
	var denied *int
	var until, restrAt *time.Time
	var restrBy *int64
	if err := row.Scan(&p.UserID, &p.Role, &rights, &p.PromotedBy, &p.Rank, &p.InviterID, &p.ViaRequest, &p.JoinedAt,
		&denied, &until, &restrBy, &restrAt); err != nil {
		return p, err
	}
	p.ChatID = chatID
	p.Rights = domain.Rights(rights)
	if denied != nil {
		r := domain.MemberRestriction{ChatID: chatID, UserID: p.UserID, DeniedRights: domain.MemberPerms(*denied), UntilDate: until}
		if restrBy != nil {
			r.RestrictedBy = *restrBy
		}
		if restrAt != nil {
			r.CreatedAt = *restrAt
		}
		p.Restriction = &r
	}
	return p, nil
}

// ListParticipants — страница участников по фильтру и ВСЕГО по фильтру
// (channels.channelParticipants.count — не длина страницы, A4-07/A6-03).
func (r *GroupRepo) ListParticipants(ctx context.Context, chatID, viewerID int64, f domain.ParticipantsFilter, offset, limit int) ([]domain.Participant, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	// q — префикс имени профиля или @username, тем же правилом, что поиск людей.
	like := ""
	if f.Q != "" {
		like = escapeLike(f.Q) + "%"
	}
	if f.Kind == domain.ParticipantsKicked {
		return r.listKicked(ctx, chatID, like, offset, limit)
	}

	where := `m.chat_id = $1 AND ($2 = '' OR u.display_name ILIKE $2 OR u.username ILIKE $2)`
	order := `m.joined_at DESC, m.user_id DESC`
	join := ""
	args := []any{chatID, like}
	switch f.Kind {
	case domain.ParticipantsAdmins:
		where += ` AND m.role IN ('creator','admin')`
		order = `(m.role = 'creator') DESC, m.joined_at, m.user_id`
	case domain.ParticipantsBanned:
		where += ` AND r.user_id IS NOT NULL AND m.role NOT IN ('creator','admin')`
		order = `r.created_at DESC, m.user_id`
	case domain.ParticipantsBots:
		where += ` AND u.is_bot`
	case domain.ParticipantsContacts:
		args = append(args, viewerID)
		join = `JOIN contacts ct ON ct.owner_id = $3 AND ct.user_id = m.user_id`
	case domain.ParticipantsMentions:
		// Сначала писавшие в этом треде (top_msg_id — номер корня в чате),
		// затем остальные — как подсказка @ у оригинала в комментариях.
		if f.TopMsgID > 0 {
			args = append(args, f.TopMsgID)
			order = `EXISTS (SELECT 1 FROM messages tm
			                  WHERE tm.chat_id = m.chat_id AND tm.sender_id = m.user_id AND tm.deleted_at IS NULL
			                    AND tm.thread_root_id = (SELECT root.id FROM messages root WHERE root.chat_id = m.chat_id AND root.seq = $3)) DESC,
			         m.joined_at DESC, m.user_id DESC`
		}
	}

	q := querier(ctx, r.pool)
	var total int
	if f.Kind == domain.ParticipantsRecent && like == "" {
		// Без поиска «недавние» — весь состав: счётчик уже денормализован.
		if err := q.QueryRow(ctx, `SELECT member_count FROM chats WHERE id = $1`, chatID).Scan(&total); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, 0, domain.ErrNotFound
			}
			return nil, 0, err
		}
	} else {
		countArgs := args
		if f.Kind == domain.ParticipantsMentions {
			countArgs = args[:2] // порядок на счёт не влияет
		}
		if err := q.QueryRow(ctx, fmt.Sprintf(
			`SELECT COUNT(*) FROM chat_members m JOIN users u ON u.id = m.user_id %s %s WHERE %s`,
			activeRestriction, join, where), countArgs...).Scan(&total); err != nil {
			return nil, 0, err
		}
	}

	args = append(args, limit, offset)
	n := len(args)
	rows, err := q.Query(ctx, fmt.Sprintf(
		`SELECT `+memberCols+`, r.denied_rights, r.until_date, r.restricted_by, r.created_at
		   FROM chat_members m
		   JOIN chats c ON c.id = m.chat_id
		   JOIN users u ON u.id = m.user_id
		   %s %s
		  WHERE %s
		  ORDER BY %s
		  LIMIT $%d OFFSET $%d`, activeRestriction, join, where, order, n-1, n), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]domain.Participant, 0)
	for rows.Next() {
		p, err := scanParticipantMember(rows, chatID)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, p)
	}
	return out, total, rows.Err()
}

// listKicked — удалённые (chat_bans): не участники, свежие сверху.
func (r *GroupRepo) listKicked(ctx context.Context, chatID int64, like string, offset, limit int) ([]domain.Participant, int, error) {
	q := querier(ctx, r.pool)
	const where = `b.chat_id = $1 AND ($2 = '' OR u.display_name ILIKE $2 OR u.username ILIKE $2)`
	var total int
	if err := q.QueryRow(ctx,
		`SELECT COUNT(*) FROM chat_bans b JOIN users u ON u.id = b.user_id WHERE `+where, chatID, like).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.Query(ctx,
		`SELECT b.user_id, COALESCE(b.banned_by, 0), b.created_at
		   FROM chat_bans b JOIN users u ON u.id = b.user_id
		  WHERE `+where+`
		  ORDER BY b.created_at DESC, b.user_id
		  LIMIT $3 OFFSET $4`, chatID, like, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]domain.Participant, 0)
	for rows.Next() {
		p := domain.Participant{Kicked: true}
		p.ChatID = chatID
		if err := rows.Scan(&p.UserID, &p.KickedBy, &p.KickedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, p)
	}
	return out, total, rows.Err()
}

// GetParticipant — один участник (channels.getParticipant): член чата с его
// ограничением или удалённый. domain.ErrNotFound — ни то ни другое
// (USER_NOT_PARTICIPANT у оригинала).
func (r *GroupRepo) GetParticipant(ctx context.Context, chatID, userID int64) (domain.Participant, error) {
	q := querier(ctx, r.pool)
	p, err := scanParticipantMember(q.QueryRow(ctx,
		`SELECT `+memberCols+`, r.denied_rights, r.until_date, r.restricted_by, r.created_at
		   FROM chat_members m
		   JOIN chats c ON c.id = m.chat_id
		   `+activeRestriction+`
		  WHERE m.chat_id = $1 AND m.user_id = $2`, chatID, userID), chatID)
	if err == nil {
		return p, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domain.Participant{}, err
	}
	k := domain.Participant{Kicked: true}
	k.ChatID, k.UserID = chatID, userID
	err = q.QueryRow(ctx,
		`SELECT COALESCE(banned_by, 0), created_at FROM chat_bans WHERE chat_id = $1 AND user_id = $2`,
		chatID, userID).Scan(&k.KickedBy, &k.KickedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Participant{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Participant{}, err
	}
	return k, nil
}

// ParticipantCounters — admins_count/kicked_count/banned_count карточки: одним
// запросом из скалярных подзапросов по индексам 0150. Кто что видит, решает
// usecase.
func (r *GroupRepo) ParticipantCounters(ctx context.Context, chatID int64) (admins, kicked, banned int, err error) {
	err = querier(ctx, r.pool).QueryRow(ctx,
		`SELECT (SELECT COUNT(*) FROM chat_members WHERE chat_id = $1 AND role IN ('creator','admin')),
		        (SELECT COUNT(*) FROM chat_bans WHERE chat_id = $1),
		        (SELECT COUNT(*) FROM chat_restrictions rr
		           JOIN chat_members mm ON mm.chat_id = rr.chat_id AND mm.user_id = rr.user_id
		          WHERE rr.chat_id = $1 AND (rr.until_date IS NULL OR rr.until_date > now())
		            AND mm.role NOT IN ('creator','admin'))`, chatID).Scan(&admins, &kicked, &banned)
	return admins, kicked, banned, err
}

// SetJoinInfo — кто привёл и вошёл ли заявкой (channelParticipantSelf
// inviter_id/via_request). Пишется после вступления (admit Ф-1б): строку
// членства создаёт он, здесь только её атрибуты. inviterID 0 — вошёл сам.
func (r *GroupRepo) SetJoinInfo(ctx context.Context, chatID, userID, inviterID int64, viaRequest bool) error {
	var inv any
	if inviterID != 0 && inviterID != userID {
		inv = inviterID
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET inviter_id = $3, via_request = $4 WHERE chat_id = $1 AND user_id = $2`,
		chatID, userID, inv, viaRequest)
	return err
}

// SetRank — подпись админа (channels.editAdmin rank, Б-117); "" — без подписи.
func (r *GroupRepo) SetRank(ctx context.Context, chatID, userID int64, rank string) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET rank = $3 WHERE chat_id = $1 AND user_id = $2`, chatID, userID, rank)
	return err
}

// RestrictedMemberIDs — участники с действующим личным ограничением, по
// возрастанию user_id после afterUserID (ключевой курсор: снятие ограничений
// во время обхода не сдвигает страницы, как OFFSET). Админов и владельца в
// выборке нет: у них ограничений не бывает (повышение их снимает).
func (r *GroupRepo) RestrictedMemberIDs(ctx context.Context, chatID, afterUserID int64, limit int) ([]int64, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT r.user_id FROM chat_restrictions r
		   JOIN chat_members m ON m.chat_id = r.chat_id AND m.user_id = r.user_id
		  WHERE r.chat_id = $1 AND r.user_id > $2
		    AND (r.until_date IS NULL OR r.until_date > now())
		    AND m.role NOT IN ('creator','admin')
		  ORDER BY r.user_id
		  LIMIT $3`, chatID, afterUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
