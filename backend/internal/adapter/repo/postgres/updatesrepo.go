package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// UpdatesRepo is a postgres-backed adapter implementing the chat usecase's UpdateRepo port.
type UpdatesRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.UpdateRepo = (*UpdatesRepo)(nil)

func NewUpdatesRepo(pool *pgxpool.Pool) *UpdatesRepo { return &UpdatesRepo{pool: pool} }

// AppendUpdate bumps the user's pts by ptsCount and writes one update row at the
// resulting pts. Returns the new pts. payload must be valid JSON.
func (r *UpdatesRepo) AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error) {
	q := querier(ctx, r.pool)
	var newPts int64
	err := q.QueryRow(ctx,
		`INSERT INTO user_state (user_id, pts, date) VALUES ($1,$2,$3)
		 ON CONFLICT (user_id) DO UPDATE SET pts = user_state.pts + $2, date = $3
		 RETURNING pts`, userID, ptsCount, date).Scan(&newPts)
	if err != nil {
		return 0, err
	}
	_, err = q.Exec(ctx,
		`INSERT INTO updates (user_id, pts, pts_count, type, payload) VALUES ($1,$2,$3,$4,$5)`,
		userID, newPts, ptsCount, typ, payload)
	return newPts, err
}

// GetUserState returns a user's current pts/date (zero values if no state yet).
func (r *UpdatesRepo) GetUserState(ctx context.Context, userID int64) (domain.UserState, error) {
	q := querier(ctx, r.pool)
	var s domain.UserState
	err := q.QueryRow(ctx, `SELECT pts, date FROM user_state WHERE user_id=$1`, userID).Scan(&s.Pts, &s.Date)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.UserState{}, nil
	}
	return s, err
}

// UpdatesSince returns updates with pts>sincePts, oldest first, up to limit.
func (r *UpdatesRepo) UpdatesSince(ctx context.Context, userID, sincePts int64, limit int) ([]domain.Update, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT pts, pts_count, type, payload FROM updates
		 WHERE user_id=$1 AND pts>$2 ORDER BY pts ASC LIMIT $3`, userID, sincePts, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Update
	for rows.Next() {
		var u domain.Update
		if err := rows.Scan(&u.Pts, &u.PtsCount, &u.Type, &u.Payload); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
