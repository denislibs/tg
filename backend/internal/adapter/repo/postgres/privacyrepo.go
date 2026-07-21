package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
)

// PrivacyRepo реализует privacy.Repo поверх privacy_rules + user_blocks.
type PrivacyRepo struct{ pool *pgxpool.Pool }

func NewPrivacyRepo(pool *pgxpool.Pool) *PrivacyRepo { return &PrivacyRepo{pool: pool} }

var _ usecaseprivacy.Repo = (*PrivacyRepo)(nil)

func scanRule(row pgx.Row) (domain.PrivacyRule, error) {
	var r domain.PrivacyRule
	var allowRaw, denyRaw []byte
	err := row.Scan(&r.Key, &r.Value, &allowRaw, &denyRaw)
	if err != nil {
		return r, err
	}
	_ = json.Unmarshal(allowRaw, &r.AllowUserIDs)
	_ = json.Unmarshal(denyRaw, &r.DenyUserIDs)
	return r, nil
}

func (r *PrivacyRepo) Rules(ctx context.Context, userID int64) ([]domain.PrivacyRule, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT key, value, allow_user_ids, deny_user_ids FROM privacy_rules WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.PrivacyRule, 0)
	for rows.Next() {
		rule, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rule)
	}
	return out, rows.Err()
}

func (r *PrivacyRepo) Get(ctx context.Context, userID int64, key domain.PrivacyKey) (domain.PrivacyRule, error) {
	rule, err := scanRule(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT key, value, allow_user_ids, deny_user_ids FROM privacy_rules WHERE user_id=$1 AND key=$2`,
		userID, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PrivacyRule{}, domain.ErrNotFound
	}
	return rule, err
}

func (r *PrivacyRepo) Upsert(ctx context.Context, userID int64, rule domain.PrivacyRule) error {
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
		`SELECT u.id, COALESCE(u.username,''), u.display_name, COALESCE(u.avatar_url,''),
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
		var u domain.BlockedUser
		if err := rows.Scan(&u.UserID, &u.Username, &u.DisplayName, &u.AvatarURL, &u.Phone); err != nil {
			return nil, 0, err
		}
		out = append(out, u)
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

// privacyAllowsSQL — SQL-эквивалент domain.PrivacyRule.Allows для правила из
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

func (r *PrivacyRepo) GetUser(ctx context.Context, id int64) (domain.User, error) {
	var u domain.User
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, phone, username, COALESCE(first_name,''), COALESCE(last_name,''),
		        display_name, COALESCE(bio,''), birthday, COALESCE(avatar_url,''), phone_visibility,
		        is_premium, COALESCE(emoji_status,'')
		   FROM users WHERE id=$1`, id).
		Scan(&u.ID, &u.Phone, &u.Username, &u.FirstName, &u.LastName,
			&u.DisplayName, &u.Bio, &u.Birthday, &u.AvatarURL, &u.PhoneVisibility,
			&u.IsPremium, &u.EmojiStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, domain.ErrNotFound
	}
	return u, err
}

func (r *PrivacyRepo) IsVerified(ctx context.Context, id int64) (bool, error) {
	var v bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT is_verified FROM users WHERE id=$1`, id).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, domain.ErrNotFound
	}
	return v, err
}

func (r *PrivacyRepo) IsBot(ctx context.Context, id int64) (bool, error) {
	var v bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT is_bot FROM users WHERE id=$1`, id).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return v, err
}
