package postgres

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// InviteRepo is a postgres-backed adapter implementing the chat usecase's
// InviteRepo port: invite link creation, token resolution (excluding revoked
// links), per-chat listing, usage counting, and revocation. Like GroupRepo it
// runs every query through querier(ctx, pool) so methods compose inside a
// TxManager transaction.
type InviteRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.InviteRepo = (*InviteRepo)(nil)

func NewInviteRepo(pool *pgxpool.Pool) *InviteRepo { return &InviteRepo{pool: pool} }

const inviteCols = `id, chat_id, token, created_by, usage_limit, uses, revoked, requires_approval, expires_at, title, created_at`

func scanLink(row pgx.Row) (domain.InviteLink, error) {
	var l domain.InviteLink
	err := row.Scan(&l.ID, &l.ChatID, &l.Token, &l.CreatedBy, &l.UsageLimit, &l.Uses, &l.Revoked, &l.RequiresApproval, &l.ExpiresAt, &l.Title, &l.CreatedAt)
	return l, err
}

func (r *InviteRepo) Create(ctx context.Context, chatID, createdBy int64, token, title string, usageLimit *int, requiresApproval bool, expiresAt *time.Time) (domain.InviteLink, error) {
	l, err := scanLink(querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO invite_links (chat_id, created_by, token, usage_limit, requires_approval, expires_at, title)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING `+inviteCols,
		chatID, createdBy, token, usageLimit, requiresApproval, expiresAt, title))
	return l, err
}

func (r *InviteRepo) GetByToken(ctx context.Context, token string) (domain.InviteLink, error) {
	l, err := scanLink(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+inviteCols+` FROM invite_links WHERE token=$1 AND revoked=false`, token))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.InviteLink{}, domain.ErrNotFound
	}
	return l, err
}

func (r *InviteRepo) List(ctx context.Context, chatID int64, revoked bool) ([]domain.InviteLink, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+inviteCols+` FROM invite_links WHERE chat_id=$1 AND revoked=$2 ORDER BY id DESC`, chatID, revoked)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.InviteLink
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (r *InviteRepo) IncUses(ctx context.Context, id int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE invite_links SET uses = uses + 1 WHERE id=$1`, id)
	return err
}

// Delete hard-deletes a single link, scoped by chat so a token from another chat
// can't be removed through this chat's endpoint.
func (r *InviteRepo) Delete(ctx context.Context, chatID int64, token string) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM invite_links WHERE chat_id=$1 AND token=$2`, chatID, token)
	return err
}

// DeleteAllRevoked hard-deletes every revoked link of the chat.
func (r *InviteRepo) DeleteAllRevoked(ctx context.Context, chatID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM invite_links WHERE chat_id=$1 AND revoked=true`, chatID)
	return err
}

// Update applies only the fields flagged in the edit; when nothing is flagged it
// simply returns the current row.
func (r *InviteRepo) Update(ctx context.Context, chatID int64, token string, e domain.InviteEdit) (domain.InviteLink, error) {
	sets := []string{}
	args := []any{}
	add := func(col string, val any) {
		args = append(args, val)
		sets = append(sets, col+"=$"+strconv.Itoa(len(args)))
	}
	if e.Title != nil {
		add("title", *e.Title)
	}
	if e.RequiresApproval != nil {
		add("requires_approval", *e.RequiresApproval)
	}
	if e.Revoked != nil {
		add("revoked", *e.Revoked)
	}
	if e.SetUsageLimit {
		add("usage_limit", e.UsageLimit)
	}
	if e.SetExpiry {
		add("expires_at", e.ExpiresAt)
	}
	q := querier(ctx, r.pool)
	if len(sets) == 0 {
		l, err := scanLink(q.QueryRow(ctx,
			`SELECT `+inviteCols+` FROM invite_links WHERE chat_id=$1 AND token=$2`, chatID, token))
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.InviteLink{}, domain.ErrNotFound
		}
		return l, err
	}
	args = append(args, chatID, token)
	sql := fmt.Sprintf(`UPDATE invite_links SET %s WHERE chat_id=$%d AND token=$%d RETURNING %s`,
		strings.Join(sets, ", "), len(args)-1, len(args), inviteCols)
	l, err := scanLink(q.QueryRow(ctx, sql, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.InviteLink{}, domain.ErrNotFound
	}
	return l, err
}

// RecordJoin logs an actual join through a link (idempotent on (token,user_id)).
func (r *InviteRepo) RecordJoin(ctx context.Context, chatID int64, token string, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO invite_link_joins (chat_id, token, user_id)
		 VALUES ($1,$2,$3) ON CONFLICT (token, user_id) DO NOTHING`,
		chatID, token, userID)
	return err
}

// Importers lists users who joined via the link (newest first) plus the total.
// Scoped by chat_id so a token belonging to another chat yields nothing.
func (r *InviteRepo) Importers(ctx context.Context, chatID int64, token string, limit int) ([]domain.InviteImporter, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := querier(ctx, r.pool)
	var total int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM invite_link_joins WHERE token=$1 AND chat_id=$2`, token, chatID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.Query(ctx,
		`SELECT user_id, joined_at FROM invite_link_joins WHERE token=$1 AND chat_id=$2 ORDER BY joined_at DESC, id DESC LIMIT $3`,
		token, chatID, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]domain.InviteImporter, 0)
	for rows.Next() {
		var im domain.InviteImporter
		if err := rows.Scan(&im.UserID, &im.JoinedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, im)
	}
	return out, total, rows.Err()
}
