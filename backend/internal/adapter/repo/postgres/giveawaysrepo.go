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
		`INSERT INTO giveaways (chat_id, creator_id, prize_kind, months, stars, winners_count, until_date, status, deposit)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
		g.ChatID, g.CreatorID, g.PrizeKind, g.Months, g.Stars, g.WinnersCount, g.UntilDate, g.Status, g.Deposit).Scan(&g.ID, &g.CreatedAt)
	return g, err
}

func (r *GiveawaysRepo) ByID(ctx context.Context, id int64) (domain.Giveaway, error) {
	var g domain.Giveaway
	var winnersRaw []byte
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, chat_id, creator_id, prize_kind, months, stars, winners_count, until_date, created_at, status, winner_ids, deposit
		   FROM giveaways WHERE id=$1`, id).
		Scan(&g.ID, &g.ChatID, &g.CreatorID, &g.PrizeKind, &g.Months, &g.Stars, &g.WinnersCount, &g.UntilDate, &g.CreatedAt, &g.Status, &winnersRaw, &g.Deposit)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Giveaway{}, domain.ErrNotFound
	}
	if err == nil && len(winnersRaw) > 0 && string(winnersRaw) != "null" {
		_ = json.Unmarshal(winnersRaw, &g.WinnerIDs)
	}
	return g, err
}

// Participate добавляет участника в АКТИВНЫЙ розыгрыш до срока (идемпотентно).
// Закрытый или просроченный - ErrForbidden: иначе участие, дошедшее после выбора
// победителей, считалось бы принятым.
func (r *GiveawaysRepo) Participate(ctx context.Context, giveawayID, userID int64) error {
	tag, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO giveaway_participants (giveaway_id, user_id)
		 SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM giveaways WHERE id=$1 AND status='active' AND until_date > now())
		 ON CONFLICT DO NOTHING`,
		giveawayID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	if ok, e := r.IsParticipant(ctx, giveawayID, userID); e != nil || ok {
		return e
	}
	return domain.ErrForbidden
}

// ClaimActiveStarsByChat закрывает незавершённые звёздные розыгрыши чата с
// вкладом (условный UPDATE: из параллельного завершения и удаления чата вклад
// получает ровно одна сторона) и возвращает их. Предварительно берёт
// блокировку строки чата: создание розыгрыша (NextSeq) ждёт её и не теряет вклад
// каскадом. Звать внутри транзакции.
func (r *GiveawaysRepo) ClaimActiveStarsByChat(ctx context.Context, chatID int64) ([]domain.Giveaway, error) {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx, `SELECT 1 FROM chats WHERE id=$1 FOR UPDATE`, chatID); err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx,
		`UPDATE giveaways SET status='finished', winner_ids='[]'
		  WHERE chat_id=$1 AND status='active' AND prize_kind='stars' AND deposit > 0
		  RETURNING id, creator_id, deposit`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Giveaway
	for rows.Next() {
		var g domain.Giveaway
		if e := rows.Scan(&g.ID, &g.CreatorID, &g.Deposit); e != nil {
			return nil, e
		}
		out = append(out, g)
	}
	return out, rows.Err()
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

// Finish закрывает АКТИВНЫЙ розыгрыш и сохраняет победителей. claimed=false —
// строка уже закрыта (условный UPDATE: из параллельных читателей выигрывает один).
func (r *GiveawaysRepo) Finish(ctx context.Context, id int64, winnerIDs []int64) (bool, error) {
	b, err := json.Marshal(winnerIDs)
	if err != nil {
		return false, err
	}
	tag, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE giveaways SET status='finished', winner_ids=$2 WHERE id=$1 AND status='active'`, id, string(b))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
