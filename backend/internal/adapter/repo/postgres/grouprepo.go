package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
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
		`SELECT chat_id, user_id, role, rights, muted FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
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

func (r *GroupRepo) SetMuted(ctx context.Context, chatID, userID int64, muted bool) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE chat_members SET muted=$3 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, muted)
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

func (r *GroupRepo) Card(ctx context.Context, chatID, viewerID int64) (domain.ChatCard, error) {
	q := querier(ctx, r.pool)
	var c domain.ChatCard
	var rights *int
	var role *string
	var muted *bool
	err := q.QueryRow(ctx,
		`SELECT c.id, c.type, c.title, COALESCE(c.username,''), c.about, c.photo_media_id,
		        COALESCE(c.creator_id,0), c.member_count, c.is_public,
		        COALESCE(c.discussion_chat_id,0),
		        m.role, m.rights, m.muted
		   FROM chats c
		   LEFT JOIN chat_members m ON m.chat_id=c.id AND m.user_id=$2
		  WHERE c.id=$1`,
		chatID, viewerID).Scan(&c.ID, &c.Type, &c.Title, &c.Username, &c.About, &c.PhotoMediaID,
		&c.CreatorID, &c.MemberCount, &c.IsPublic, &c.DiscussionChatID, &role, &rights, &muted)
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
		`SELECT chat_id, user_id, role, rights, muted FROM chat_members
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
		`SELECT id, COALESCE(username,''), display_name, COALESCE(avatar_url,'') FROM users WHERE id = ANY($1)`, ids)
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
