package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// GroupRepo is a postgres-backed adapter implementing the chat usecase's GroupRepo
// port: multi-member chat creation, membership/roles/rights, per-chat mute, the
// chat card read model, denormalized member_count maintenance, and a batch user
// lookup. It mirrors ChatsRepo and runs every query through querier(ctx, pool) so
// methods compose inside a TxManager transaction.
type GroupRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.GroupRepo = (*GroupRepo)(nil)

func NewGroupRepo(pool *pgxpool.Pool) *GroupRepo { return &GroupRepo{pool: pool} }

func (r *GroupRepo) CreateMultiMember(ctx context.Context, typ, title, about, username string, isPublic bool, creatorID int64) (int64, error) {
	q := querier(ctx, r.pool)
	var id int64
	var u any
	if username != "" {
		u = username
	}
	err := q.QueryRow(ctx,
		`INSERT INTO chats (type, title, about, username, is_public, creator_id)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		typ, title, about, u, isPublic, creatorID).Scan(&id)
	return id, err
}

func (r *GroupRepo) AddMember(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error {
	q := querier(ctx, r.pool)
	ct, err := q.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id, role, rights)
		 VALUES ($1,$2,$3,$4) ON CONFLICT (chat_id,user_id) DO NOTHING`,
		chatID, userID, role, int(rights))
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 1 {
		_, err = q.Exec(ctx, `UPDATE chats SET member_count = member_count + 1 WHERE id=$1`, chatID)
	}
	return err
}

func (r *GroupRepo) RemoveMember(ctx context.Context, chatID, userID int64) error {
	q := querier(ctx, r.pool)
	ct, err := q.Exec(ctx, `DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 1 {
		_, err = q.Exec(ctx, `UPDATE chats SET member_count = GREATEST(member_count - 1, 0) WHERE id=$1`, chatID)
	}
	return err
}

func (r *GroupRepo) GetMember(ctx context.Context, chatID, userID int64) (domain.Member, error) {
	q := querier(ctx, r.pool)
	var m domain.Member
	var rights int
	err := q.QueryRow(ctx,
		`SELECT chat_id, user_id, role, rights,
		        (muted OR (muted_until IS NOT NULL AND muted_until > now()))
		   FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID).Scan(&m.ChatID, &m.UserID, &m.Role, &rights, &m.Muted)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Member{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Member{}, err
	}
	m.Rights = domain.Rights(rights)
	return m, nil
}

func (r *GroupRepo) SetRole(ctx context.Context, chatID, userID int64, role string, rights domain.Rights) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET role=$3, rights=$4 WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, role, int(rights))
	return err
}

func (r *GroupRepo) SetMuted(ctx context.Context, chatID, userID int64, muted bool, until *time.Time) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET muted=$3, muted_until=$4 WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, muted, until)
	return err
}

// SetPinned закрепляет/открепляет диалог для пользователя. pinned_at = момент
// закрепления: свежий пин встаёт первым в списке.
func (r *GroupRepo) SetPinned(ctx context.Context, chatID, userID int64, pinned bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET pinned_at = CASE WHEN $3 THEN now() ELSE NULL END
		 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, pinned)
	return err
}

// CountPinned — сколько диалогов пользователь закрепил в основном списке
// (архив не считается: у него свой набор пинов, как папки tweb).
func (r *GroupRepo) CountPinned(ctx context.Context, userID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM chat_members WHERE user_id=$1 AND pinned_at IS NOT NULL AND NOT archived`,
		userID).Scan(&n)
	return n, err
}

// SetForum включает/выключает темы у группы (chats.is_forum).
func (r *GroupRepo) SetForum(ctx context.Context, chatID int64, enabled bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE chats SET is_forum=$2 WHERE id=$1`, chatID, enabled)
	return err
}

// SetArchived убирает диалог в архив / возвращает из него; пин при переносе
// сбрасывается (в tweb наборы пинов у папок раздельные).
func (r *GroupRepo) SetArchived(ctx context.Context, chatID, userID int64, archived bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET archived=$3, pinned_at=NULL WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, archived)
	return err
}

func (r *GroupRepo) EditInfo(ctx context.Context, chatID int64, title, about, username string) error {
	var u any
	if username != "" {
		u = username
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET title=$2, about=$3, username=$4 WHERE id=$1`, chatID, title, about, u)
	return err
}

func (r *GroupRepo) SetPhoto(ctx context.Context, chatID, mediaID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET photo_media_id=$2 WHERE id=$1`, chatID, mediaID)
	return err
}

func (r *GroupRepo) Settings(ctx context.Context, chatID int64) (domain.ChatSettings, error) {
	var s domain.ChatSettings
	var perms int
	var allowed []byte
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT default_permissions, slowmode_seconds, reactions_mode, reactions_allowed, history_for_new
		 FROM chats WHERE id=$1`, chatID).
		Scan(&perms, &s.SlowmodeSeconds, &s.ReactionsMode, &allowed, &s.HistoryForNew)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ChatSettings{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.ChatSettings{}, err
	}
	s.DefaultPerms = domain.MemberPerms(perms)
	if len(allowed) > 0 {
		_ = json.Unmarshal(allowed, &s.ReactionsAllowed)
	}
	return s, nil
}

// SetType switches private/public. Public requires a username (unique across
// chats); switching to private clears it. domain.ErrConflict on a taken name.
func (r *GroupRepo) SetType(ctx context.Context, chatID int64, isPublic bool, username string) error {
	var u any
	if isPublic && username != "" {
		u = username
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET is_public=$2, username=$3 WHERE id=$1`, chatID, isPublic, u)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
		return domain.ErrConflict
	}
	return err
}

func (r *GroupRepo) SetPermissions(ctx context.Context, chatID int64, perms domain.MemberPerms, slowmodeSeconds int) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET default_permissions=$2, slowmode_seconds=$3 WHERE id=$1`,
		chatID, int(perms), slowmodeSeconds)
	return err
}

func (r *GroupRepo) SetReactions(ctx context.Context, chatID int64, mode string, allowed []string) error {
	var list any
	if len(allowed) > 0 {
		b, err := json.Marshal(allowed)
		if err != nil {
			return err
		}
		list = string(b) // jsonb через string, не []byte (см. CLAUDE.md)
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET reactions_mode=$2, reactions_allowed=$3 WHERE id=$1`, chatID, mode, list)
	return err
}

func (r *GroupRepo) SetHistoryForNew(ctx context.Context, chatID int64, visible bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET history_for_new=$2 WHERE id=$1`, chatID, visible)
	return err
}

func (r *GroupRepo) Ban(ctx context.Context, chatID, userID, bannedBy int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO chat_bans (chat_id, user_id, banned_by) VALUES ($1,$2,$3)
		 ON CONFLICT (chat_id, user_id) DO NOTHING`, chatID, userID, bannedBy)
	return err
}

func (r *GroupRepo) Unban(ctx context.Context, chatID, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM chat_bans WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	return err
}

func (r *GroupRepo) IsBanned(ctx context.Context, chatID, userID int64) (bool, error) {
	var banned bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM chat_bans WHERE chat_id=$1 AND user_id=$2)`, chatID, userID).Scan(&banned)
	return banned, err
}

func (r *GroupRepo) ListBans(ctx context.Context, chatID int64) ([]domain.BannedUser, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT user_id, COALESCE(banned_by,0) FROM chat_bans WHERE chat_id=$1 ORDER BY created_at DESC`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.BannedUser{}
	for rows.Next() {
		var b domain.BannedUser
		if err := rows.Scan(&b.UserID, &b.BannedBy); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (r *GroupRepo) DeleteChat(ctx context.Context, chatID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `DELETE FROM chats WHERE id=$1`, chatID)
	return err
}

func (r *GroupRepo) Card(ctx context.Context, chatID, viewerID int64) (domain.ChatCard, error) {
	q := querier(ctx, r.pool)
	var c domain.ChatCard
	var rights *int
	var role *string
	var muted *bool
	var perms int
	var allowed []byte
	err := q.QueryRow(ctx,
		`SELECT c.id, c.type, c.title, COALESCE(c.username,''), c.about, c.photo_media_id,
		        COALESCE(c.creator_id,0), c.member_count, c.is_public,
		        COALESCE(c.discussion_chat_id,0),
		        c.default_permissions, c.slowmode_seconds, c.reactions_mode, c.reactions_allowed, c.history_for_new,
		        m.role, m.rights, (m.muted OR (m.muted_until IS NOT NULL AND m.muted_until > now()))
		   FROM chats c
		   LEFT JOIN chat_members m ON m.chat_id=c.id AND m.user_id=$2
		  WHERE c.id=$1`,
		chatID, viewerID).Scan(&c.ID, &c.Type, &c.Title, &c.Username, &c.About, &c.PhotoMediaID,
		&c.CreatorID, &c.MemberCount, &c.IsPublic, &c.DiscussionChatID,
		&perms, &c.Settings.SlowmodeSeconds, &c.Settings.ReactionsMode, &allowed, &c.Settings.HistoryForNew,
		&role, &rights, &muted)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ChatCard{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.ChatCard{}, err
	}
	if role != nil {
		c.MyRole = *role
	}
	if rights != nil {
		c.MyRights = domain.Rights(*rights)
	}
	if muted != nil {
		c.Muted = *muted
	}
	c.Settings.DefaultPerms = domain.MemberPerms(perms)
	if len(allowed) > 0 {
		_ = json.Unmarshal(allowed, &c.Settings.ReactionsAllowed)
	}
	return c, nil
}

func (r *GroupRepo) ListMembers(ctx context.Context, chatID int64, offset, limit int) ([]domain.Member, error) {
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT chat_id, user_id, role, rights,
		        (muted OR (muted_until IS NOT NULL AND muted_until > now()))
		   FROM chat_members
		  WHERE chat_id=$1 ORDER BY role DESC, user_id LIMIT $2 OFFSET $3`,
		chatID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Member, 0)
	for rows.Next() {
		var m domain.Member
		var rights int
		if err := rows.Scan(&m.ChatID, &m.UserID, &m.Role, &rights, &m.Muted); err != nil {
			return nil, err
		}
		m.Rights = domain.Rights(rights)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *GroupRepo) SetDiscussion(ctx context.Context, channelID, groupID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, channelID, groupID)
	return err
}

func (r *GroupRepo) GetDiscussion(ctx context.Context, channelID int64) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT COALESCE(discussion_chat_id,0) FROM chats WHERE id=$1`, channelID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return id, err
}

func (r *GroupRepo) UsersByIDs(ctx context.Context, ids []int64) ([]domain.UserCard, error) {
	if len(ids) == 0 {
		return []domain.UserCard{}, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, COALESCE(username,''), display_name, COALESCE(first_name,''), COALESCE(avatar_url,'') FROM users WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.UserCard
	for rows.Next() {
		var u domain.UserCard
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.FirstName, &u.AvatarURL); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
