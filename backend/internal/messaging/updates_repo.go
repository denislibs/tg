package messaging

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

type Update struct {
	Pts      int64
	PtsCount int
	Type     string
	Payload  json.RawMessage
}

type UserState struct {
	Pts  int64 `json:"pts"`
	Date int64 `json:"date"`
}

type UpdatesRepo struct{}

func NewUpdatesRepo() *UpdatesRepo { return &UpdatesRepo{} }

// AppendUpdate bumps the user's pts by ptsCount and writes one update row at the
// resulting pts. Returns the new pts. payload must be valid JSON.
func (r *UpdatesRepo) AppendUpdate(ctx context.Context, q Querier, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error) {
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
func (r *UpdatesRepo) GetUserState(ctx context.Context, q Querier, userID int64) (UserState, error) {
	var s UserState
	err := q.QueryRow(ctx, `SELECT pts, date FROM user_state WHERE user_id=$1`, userID).Scan(&s.Pts, &s.Date)
	if err == pgx.ErrNoRows {
		return UserState{}, nil
	}
	return s, err
}

// UpdatesSince returns updates with pts>sincePts, oldest first, up to limit.
func (r *UpdatesRepo) UpdatesSince(ctx context.Context, q Querier, userID, sincePts int64, limit int) ([]Update, error) {
	rows, err := q.Query(ctx,
		`SELECT pts, pts_count, type, payload FROM updates
		 WHERE user_id=$1 AND pts>$2 ORDER BY pts ASC LIMIT $3`, userID, sincePts, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Update
	for rows.Next() {
		var u Update
		if err := rows.Scan(&u.Pts, &u.PtsCount, &u.Type, &u.Payload); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
