package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
)

// PrivacyRepo реализует privacy.Repo поверх privacy_rules + user_blocks.
type PrivacyRepo struct{ pool *pgxpool.Pool }

func NewPrivacyRepo(pool *pgxpool.Pool) *PrivacyRepo { return &PrivacyRepo{pool: pool} }

var _ usecaseprivacy.Repo = (*PrivacyRepo)(nil)

func scanRule(row pgx.Row) (domain.PrivacyRuleRecord, error) {
	var r domain.PrivacyRuleRecord
	var allowRaw, denyRaw []byte
	err := row.Scan(&r.Key, &r.Value, &allowRaw, &denyRaw)
	if err != nil {
		return r, err
	}
	_ = json.Unmarshal(allowRaw, &r.AllowUserIDs)
	_ = json.Unmarshal(denyRaw, &r.DenyUserIDs)
	return r, nil
}

func (r *PrivacyRepo) Rules(ctx context.Context, userID int64) ([]domain.PrivacyRuleRecord, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT key, value, allow_user_ids, deny_user_ids FROM privacy_rules WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.PrivacyRuleRecord, 0)
	for rows.Next() {
		rule, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rule)
	}
	return out, rows.Err()
}

func (r *PrivacyRepo) Get(ctx context.Context, userID int64, key domain.PrivacyKey) (domain.PrivacyRuleRecord, error) {
	rule, err := scanRule(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT key, value, allow_user_ids, deny_user_ids FROM privacy_rules WHERE user_id=$1 AND key=$2`,
		userID, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PrivacyRuleRecord{}, domain.ErrNotFound
	}
	return rule, err
}

func (r *PrivacyRepo) Upsert(ctx context.Context, userID int64, rule domain.PrivacyRuleRecord) error {
	allow, err := json.Marshal(orEmpty(rule.AllowUserIDs))
	if err != nil {
		return err
	}
	deny, err := json.Marshal(orEmpty(rule.DenyUserIDs))
	if err != nil {
		return err
	}
	_, err = querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO privacy_rules (user_id, key, value, allow_user_ids, deny_user_ids)
		 VALUES ($1,$2,$3,$4,$5)
		 ON CONFLICT (user_id, key) DO UPDATE SET value=$3, allow_user_ids=$4, deny_user_ids=$5`,
		userID, rule.Key, rule.Value, string(allow), string(deny))
	return err
}

func orEmpty(ids []int64) []int64 {
	if ids == nil {
		return []int64{}
	}
	return ids
}

func (r *PrivacyRepo) Block(ctx context.Context, blockerID, blockedID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		blockerID, blockedID)
	if isForeignKeyViolation(err) {
		return domain.ErrNotFound
	}
	return err
}

func (r *PrivacyRepo) Unblock(ctx context.Context, blockerID, blockedID int64) (bool, error) {
	tag, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2`, blockerID, blockedID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (r *PrivacyRepo) IsBlocked(ctx context.Context, blockerID, blockedID int64) (bool, error) {
	var yes bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2)`,
		blockerID, blockedID).Scan(&yes)
	return yes, err
}

func (r *PrivacyRepo) BlockedList(ctx context.Context, userID int64, offset, limit int) ([]domain.BlockedUser, int, error) {
	q := querier(ctx, r.pool)
	var total int
	if err := q.QueryRow(ctx,
		`SELECT COUNT(*) FROM user_blocks WHERE blocker_id=$1`, userID).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Телефон в ряду показывается по правилу phone_number заблокированного
	// относительно блокировщика (блок направлен в другую сторону и его не гасит).
	rows, err := q.Query(ctx,
		`SELECT `+userSeenCols("u.", "$1")+`, b.created_at,
		        CASE WHEN `+privacyAllowsSQL("u.id", "$1", "pr")+` THEN u.phone ELSE '' END
		   FROM user_blocks b
		   JOIN users u ON u.id = b.blocked_id
		   LEFT JOIN privacy_rules pr ON pr.user_id = u.id AND pr.key = 'phone_number'
		  WHERE b.blocker_id = $1
		  ORDER BY b.created_at DESC, u.id
		  LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]domain.BlockedUser, 0)
	for rows.Next() {
		var s userSeenScan
		var blockedAt time.Time
		var phone string
		if err := rows.Scan(append(s.dest(), &blockedAt, &phone)...); err != nil {
			return nil, 0, err
		}
		u := s.user(true)
		u.Phone = phone
		out = append(out, domain.BlockedUser{
			Blocked: domain.NewPeerBlocked(domain.NewPeerUser(u.ID), blockedAt),
			User:    u,
		})
	}
	return out, total, rows.Err()
}

func (r *PrivacyRepo) IsContact(ctx context.Context, ownerID, userID int64) (bool, error) {
	var yes bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM contacts WHERE owner_id=$1 AND user_id=$2)`,
		ownerID, userID).Scan(&yes)
	return yes, err
}

// ContactCard — то, что зритель знает о пире по адресным книгам, одним
// запросом: пир в книге зрителя (и под каким именем), зритель в книге пира,
// заметка зрителя и его личное фото для пира. Личное фото не требует записи в книге — как и в
// списке диалогов, оно накладывается по одной таблице contact_custom_photo.
func (r *PrivacyRepo) ContactCard(ctx context.Context, viewerID, targetID int64) (domain.ContactCard, error) {
	var card domain.ContactCard
	var noteText string
	var noteEntities []byte
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT c.user_id IS NOT NULL,
		        EXISTS(SELECT 1 FROM contacts m WHERE m.owner_id = $2 AND m.user_id = $1),
		        COALESCE(c.first_name, ''), COALESCE(c.last_name, ''),
		        COALESCE(c.note, ''), COALESCE(c.note_entities, '[]'),
		        COALESCE(p.media_id, 0)
		   FROM (SELECT 1) AS one
		   LEFT JOIN contacts c ON c.owner_id = $1 AND c.user_id = $2
		   LEFT JOIN contact_custom_photo p ON p.owner_id = $1 AND p.contact_user_id = $2`,
		viewerID, targetID).Scan(&card.Contact, &card.Mutual, &card.FirstName, &card.LastName,
		&noteText, &noteEntities, &card.PersonalPhotoID)
	if err != nil {
		return domain.ContactCard{}, err
	}
	card.Note = contactNote(noteText, noteEntities)
	return card, nil
}

// ContactViews — как книги зрителей viewerIDs видят пользователя userID
// (usecase/auth.ContactViewer): имя, под которым зритель его сохранил, и есть
// ли зритель в книге самого userID. Зрители без связи в ответ не попадают.
func (r *PrivacyRepo) ContactViews(ctx context.Context, userID int64, viewerIDs []int64) (map[int64]domain.ContactView, error) {
	out := make(map[int64]domain.ContactView, len(viewerIDs))
	if len(viewerIDs) == 0 {
		return out, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT v.id, `+contactViewCols("$1::bigint", "v.id")+`
		   FROM unnest($2::bigint[]) AS v(id)`, userID, viewerIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var s userSeenScan
		if err := rows.Scan(&id, &s.contactName, &s.mutual); err != nil {
			return nil, err
		}
		if v := s.view(); v.Contact || v.Mutual {
			out[id] = v
		}
	}
	return out, rows.Err()
}

// privacyAllowsSQL — SQL-эквивалент domain.PrivacyRuleRecord.Allows для правила из
// алиаса pr (может быть NULL — тогда дефолт ключа считает вызывающий запрос
// через privacyDefaultSQL). owner/viewer — SQL-выражения с id сторон.
// Порядок tweb: deny → allow → значение (contacts = owner сохранил viewer).
func privacyAllowsSQL(owner, viewer, pr string) string {
	return `(
		NOT ` + pr + `.deny_user_ids @> to_jsonb(ARRAY[` + viewer + `::bigint]) AND (
			` + pr + `.allow_user_ids @> to_jsonb(ARRAY[` + viewer + `::bigint]) OR
			COALESCE(` + pr + `.value, 'contacts') = 'everybody' OR
			(COALESCE(` + pr + `.value, 'contacts') = 'contacts' AND EXISTS(
				SELECT 1 FROM contacts cc WHERE cc.owner_id = ` + owner + ` AND cc.user_id = ` + viewer + `))
		)
	)`
}

// VisibleMap — один запрос на пачку владельцев: блок (owner заблокировал
// viewer) закрывает всё; иначе правило ключа (или его дефолт) + контактность.
func (r *PrivacyRepo) VisibleMap(ctx context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT o.id,
		        o.id = $1 OR (
		          NOT EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker_id = o.id AND b.blocked_id = $1)
		          AND (
		            NOT COALESCE(pr.deny_user_ids, '[]') @> to_jsonb(ARRAY[$1::bigint]) AND (
		              COALESCE(pr.allow_user_ids, '[]') @> to_jsonb(ARRAY[$1::bigint]) OR
		              COALESCE(pr.value, $3) = 'everybody' OR
		              (COALESCE(pr.value, $3) = 'contacts' AND EXISTS(
		                SELECT 1 FROM contacts cc WHERE cc.owner_id = o.id AND cc.user_id = $1))
		            )
		          )
		        )
		   FROM unnest($2::bigint[]) AS o(id)
		   LEFT JOIN privacy_rules pr ON pr.user_id = o.id AND pr.key = $4`,
		viewerID, ownerIDs, domain.DefaultPrivacyValue(key), string(key))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[int64]bool, len(ownerIDs))
	for rows.Next() {
		var id int64
		var ok bool
		if err := rows.Scan(&id, &ok); err != nil {
			return nil, err
		}
		out[id] = ok
	}
	return out, rows.Err()
}

func (r *PrivacyRepo) GetUser(ctx context.Context, id int64) (domain.UserRecord, error) {
	var u domain.UserRecord
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, COALESCE(phone,''), username, COALESCE(first_name,''), COALESCE(last_name,''),
		        COALESCE(bio,''), birthday, avatar_media_id, avatar_preview,
		        is_premium, is_verified, is_bot, deleted_at IS NOT NULL, COALESCE(emoji_status,''), is_service
		   FROM users WHERE id=$1`, id).
		Scan(&u.ID, &u.Phone, &u.Username, &u.FirstName, &u.LastName,
			&u.Bio, &u.Birthday, &u.PhotoID, &u.PhotoPreview,
			&u.IsPremium, &u.IsVerified, &u.IsBot, &u.Deleted, &u.EmojiStatus, &u.IsService)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.UserRecord{}, domain.ErrNotFound
	}
	return u, err
}

// TTLPeriod — период автоудаления переписки зрителя с этим пиром: сначала
// auto_delete_period самого приватного чата, а пока чата нет — глобальный
// дефолт ЗРИТЕЛЯ, которым такой чат заведётся (chatsrepo делает ровно это при
// создании приватного чата). Отдельных запросов два только на бумаге: COALESCE
// внутри одного.
func (r *PrivacyRepo) TTLPeriod(ctx context.Context, viewerID, targetID int64) (int, error) {
	var ttl int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(
		          (SELECT c.auto_delete_period FROM chats c
		             JOIN chat_members a ON a.chat_id = c.id AND a.user_id = $1
		             JOIN chat_members b ON b.chat_id = c.id AND b.user_id = $2
		            WHERE c.type = 'private' LIMIT 1),
		          (SELECT auto_delete_period FROM users WHERE id = $1),
		          0)`, viewerID, targetID).Scan(&ttl)
	return ttl, err
}

// ChatTheme — тема оформления переписки зрителя с этим пиром: chat_theme того
// самого приватного чата. Чата ещё нет — темы тоже нет, и это "" , а не дефолт:
// «тема не задана» у нас и означает дефолтное оформление.
func (r *PrivacyRepo) ChatTheme(ctx context.Context, viewerID, targetID int64) (string, error) {
	var theme string
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(
		          (SELECT ct.theme_id FROM chats c
		             JOIN chat_members a ON a.chat_id = c.id AND a.user_id = $1
		             JOIN chat_members b ON b.chat_id = c.id AND b.user_id = $2
		             JOIN chat_theme ct ON ct.chat_id = c.id
		            WHERE c.type = 'private' LIMIT 1),
		          '')`, viewerID, targetID).Scan(&theme)
	return theme, err
}
