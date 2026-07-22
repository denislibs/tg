package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// GiveawaysRepo хранит розыгрыши и участников (таблицы giveaways /
// giveaway_participants).
type GiveawaysRepo struct {
	pool *pgxpool.Pool
}

func NewGiveawaysRepo(pool *pgxpool.Pool) *GiveawaysRepo { return &GiveawaysRepo{pool: pool} }

func (r *GiveawaysRepo) Create(ctx context.Context, g domain.Giveaway) (domain.Giveaway, error) {
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO giveaways (chat_id, creator_id, prize_kind, months, stars, winners_count, until_date, status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		g.ChatID, g.CreatorID, g.PrizeKind, g.Months, g.Stars, g.WinnersCount, g.UntilDate, g.Status).Scan(&g.ID)
	return g, err
}

func (r *GiveawaysRepo) ByID(ctx context.Context, id int64) (domain.Giveaway, error) {
	var g domain.Giveaway
	var winnersRaw []byte
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, chat_id, creator_id, prize_kind, months, stars, winners_count, until_date, status, winner_ids
		   FROM giveaways WHERE id=$1`, id).
		Scan(&g.ID, &g.ChatID, &g.CreatorID, &g.PrizeKind, &g.Months, &g.Stars, &g.WinnersCount, &g.UntilDate, &g.Status, &winnersRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Giveaway{}, domain.ErrNotFound
	}
	if err == nil && len(winnersRaw) > 0 && string(winnersRaw) != "null" {
		_ = json.Unmarshal(winnersRaw, &g.WinnerIDs)
	}
	return g, err
}

// Participate добавляет участника (идемпотентно).
func (r *GiveawaysRepo) Participate(ctx context.Context, giveawayID, userID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO giveaway_participants (giveaway_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		giveawayID, userID)
	return err
}

func (r *GiveawaysRepo) IsParticipant(ctx context.Context, giveawayID, userID int64) (bool, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM giveaway_participants WHERE giveaway_id=$1 AND user_id=$2`,
		giveawayID, userID).Scan(&n)
	return n > 0, err
}

func (r *GiveawaysRepo) ParticipantCount(ctx context.Context, id int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM giveaway_participants WHERE giveaway_id=$1`, id).Scan(&n)
	return n, err
}

func (r *GiveawaysRepo) ParticipantIDs(ctx context.Context, id int64) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT user_id FROM giveaway_participants WHERE giveaway_id=$1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var uid int64
		if e := rows.Scan(&uid); e != nil {
			return nil, e
		}
		ids = append(ids, uid)
	}
	return ids, rows.Err()
}

// Finish помечает розыгрыш завершённым и сохраняет победителей.
func (r *GiveawaysRepo) Finish(ctx context.Context, id int64, winnerIDs []int64) error {
	b, err := json.Marshal(winnerIDs)
	if err != nil {
		return err
	}
	_, err = querier(ctx, r.pool).Exec(ctx,
		`UPDATE giveaways SET status='finished', winner_ids=$2 WHERE id=$1`, id, string(b))
	return err
}
