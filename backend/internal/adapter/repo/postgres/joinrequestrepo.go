package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// JoinRequestRepo is a postgres-backed adapter implementing the chat usecase's
// JoinRequestRepo port: pending join requests for approval-required invite
// links. Like the other repos it runs every query through querier(ctx, pool)
// so methods compose inside a TxManager transaction.
type JoinRequestRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.JoinRequestRepo = (*JoinRequestRepo)(nil)

func NewJoinRequestRepo(pool *pgxpool.Pool) *JoinRequestRepo { return &JoinRequestRepo{pool: pool} }

// Create records a pending join request. It is idempotent: a repeat request for
// the same (chat, user) is dropped via the UNIQUE (chat_id, user_id) constraint.
func (r *JoinRequestRepo) Create(ctx context.Context, chatID, userID int64, inviteToken string) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO join_requests (chat_id, user_id, invite_token)
		 VALUES ($1,$2,$3) ON CONFLICT (chat_id, user_id) DO NOTHING`,
		chatID, userID, inviteToken)
	return err
}

// List — страница заявок (messages.getChatInviteImporters{requested}): свежие
// сверху, курсор (offset_date, offset_user) — последняя полученная строка, q —
// префикс имени или @username; total — всего по q.
func (r *JoinRequestRepo) List(ctx context.Context, chatID int64, q string, offsetDate time.Time, offsetUser int64, limit int) ([]domain.JoinRequest, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	like := ""
	if q != "" {
		like = escapeLike(q) + "%"
	}
	const where = `j.chat_id = $1 AND ($2 = '' OR u.display_name ILIKE $2 OR u.username ILIKE $2)`
	db := querier(ctx, r.pool)
	var total int
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM join_requests j JOIN users u ON u.id = j.user_id WHERE `+where, chatID, like).Scan(&total); err != nil {
		return nil, 0, err
	}
	var cursor any
	if !offsetDate.IsZero() {
		cursor = offsetDate
	}
	rows, err := db.Query(ctx,
		`SELECT j.chat_id, j.user_id, j.created_at
		   FROM join_requests j JOIN users u ON u.id = j.user_id
		  WHERE `+where+`
		    AND ($3::timestamptz IS NULL OR (j.created_at, j.user_id) < ($3, $4))
		  ORDER BY j.created_at DESC, j.user_id DESC
		  LIMIT $5`, chatID, like, cursor, offsetUser, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []domain.JoinRequest{}
	for rows.Next() {
		var jr domain.JoinRequest
		if err := rows.Scan(&jr.ChatID, &jr.UserID, &jr.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, jr)
	}
	return out, total, rows.Err()
}

// Pending — requests_pending и recent_requesters (три свежих — плашка заявок
// tweb рисует не больше трёх аватарок, chat/requests.tsx).
func (r *JoinRequestRepo) Pending(ctx context.Context, chatID int64) (int, []int64, error) {
	db := querier(ctx, r.pool)
	var n int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM join_requests WHERE chat_id = $1`, chatID).Scan(&n); err != nil {
		return 0, nil, err
	}
	rows, err := db.Query(ctx,
		`SELECT user_id FROM join_requests WHERE chat_id = $1 ORDER BY created_at DESC, user_id DESC LIMIT 3`, chatID)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	recent := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, nil, err
		}
		recent = append(recent, id)
	}
	return n, recent, rows.Err()
}

func (r *JoinRequestRepo) Delete(ctx context.Context, chatID, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM join_requests WHERE chat_id=$1 AND user_id=$2`, chatID, userID)
	return err
}

// TokenFor returns the invite token the pending request came through ("" if the
// request has no token); ok=false — заявки нет вовсе.
func (r *JoinRequestRepo) TokenFor(ctx context.Context, chatID, userID int64) (string, bool, error) {
	var token *string
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT invite_token FROM join_requests WHERE chat_id=$1 AND user_id=$2`, chatID, userID).Scan(&token)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if token == nil {
		return "", true, nil
	}
	return *token, true, nil
}
