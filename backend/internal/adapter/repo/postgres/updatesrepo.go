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

// AppendUpdateBulk bumps pts for many users and writes one update row per user in
// a SINGLE round-trip (vs AppendUpdate's 2 queries × N users). Returns per-user
// resulting pts. payload is identical for every user in the batch. Data-modifying
// CTEs run to completion even though only `bumped` is selected.
func (r *UpdatesRepo) AppendUpdateBulk(ctx context.Context, userIDs []int64, ptsCount int, date int64, typ string, payload json.RawMessage) (map[int64]int64, error) {
	out := make(map[int64]int64, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`WITH bumped AS (
		   INSERT INTO user_state (user_id, pts, date)
		   SELECT u, $2, $3 FROM unnest($1::bigint[]) AS u
		   ON CONFLICT (user_id) DO UPDATE SET pts = user_state.pts + $2, date = $3
		   RETURNING user_id, pts
		 ), ins AS (
		   INSERT INTO updates (user_id, pts, pts_count, type, payload)
		   SELECT user_id, pts, $2, $4, $5 FROM bumped
		 )
		 SELECT user_id, pts FROM bumped`,
		userIDs, ptsCount, date, typ, payload)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid, pts int64
		if err := rows.Scan(&uid, &pts); err != nil {
			return nil, err
		}
		out[uid] = pts
	}
	return out, rows.Err()
}

// PruneUpdates deletes update-log rows more than keepPerUser pts behind each
// user's current pts, in one bounded statement (≤ maxRows). Safe: any client
// within keepPerUser still has all its rows, and keepPerUser must be ≥ the sync
// too-long threshold so further-behind clients get a full resync instead of a
// silent gap. Called periodically to bound otherwise-unbounded log growth (one
// row per recipient per event). Returns rows deleted; a periodic ticker chips
// away at any large initial backlog across successive calls.
func (r *UpdatesRepo) PruneUpdates(ctx context.Context, keepPerUser int64, maxRows int) (int64, error) {
	q := querier(ctx, r.pool)
	tag, err := q.Exec(ctx,
		`DELETE FROM updates WHERE ctid IN (
		   SELECT u.ctid FROM updates u JOIN user_state s ON u.user_id = s.user_id
		   WHERE u.pts <= s.pts - $1 LIMIT $2
		 )`, keepPerUser, maxRows)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
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
func (r *UpdatesRepo) UpdatesSince(ctx context.Context, userID, sincePts int64, limit int) ([]domain.UpdateRecord, error) {
	q := querier(ctx, r.pool)
	rows, err := q.Query(ctx,
		`SELECT pts, pts_count, type, payload FROM updates
		 WHERE user_id=$1 AND pts>$2 ORDER BY pts ASC LIMIT $3`, userID, sincePts, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.UpdateRecord
	for rows.Next() {
		var u domain.UpdateRecord
		if err := rows.Scan(&u.Pts, &u.PtsCount, &u.Type, &u.Payload); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
