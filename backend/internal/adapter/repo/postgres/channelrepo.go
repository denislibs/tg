package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// ChannelRepo is a postgres-backed adapter implementing the chat usecase's
// ChannelRepo port: the per-channel pts counter (chats.channel_pts) plus the
// channel_updates log that backs O(1) channel post delivery and the
// GET /channels/{id}/difference catch-up feed. Like the sibling repos it runs
// every query through querier(ctx, pool) so methods compose inside a TxManager
// transaction.
type ChannelRepo struct{ pool *pgxpool.Pool }

var _ usecasechat.ChannelRepo = (*ChannelRepo)(nil)

func NewChannelRepo(pool *pgxpool.Pool) *ChannelRepo { return &ChannelRepo{pool: pool} }

func (r *ChannelRepo) AppendUpdate(ctx context.Context, channelID int64, payload json.RawMessage) (int64, error) {
	q := querier(ctx, r.pool)
	var pts int64
	// atomically bump and read the channel pts (row-locked by the UPDATE)
	if err := q.QueryRow(ctx,
		`UPDATE chats SET channel_pts = channel_pts + 1 WHERE id=$1 RETURNING channel_pts`,
		channelID).Scan(&pts); err != nil {
		return 0, err
	}
	if _, err := q.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, pts_count, payload) VALUES ($1,$2,1,$3)`,
		channelID, pts, []byte(payload)); err != nil {
		return 0, err
	}
	return pts, nil
}

func (r *ChannelRepo) UpdatesSince(ctx context.Context, channelID, sincePts int64, limit int) ([]domain.ChannelUpdate, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT pts, pts_count, payload FROM channel_updates
		 WHERE channel_id=$1 AND pts>$2 ORDER BY pts ASC LIMIT $3`, channelID, sincePts, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ChannelUpdate
	for rows.Next() {
		var u domain.ChannelUpdate
		if err := rows.Scan(&u.Pts, &u.PtsCount, &u.Payload); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *ChannelRepo) CurrentPts(ctx context.Context, channelID int64) (int64, error) {
	var pts int64
	err := querier(ctx, r.pool).QueryRow(ctx, `SELECT channel_pts FROM chats WHERE id=$1`, channelID).Scan(&pts)
	return pts, err
}
