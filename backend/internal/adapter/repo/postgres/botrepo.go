package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// BotRepo — флаг is_bot и команды ботов (таблицы users.is_bot / bot_commands).
type BotRepo struct {
	pool *pgxpool.Pool
}

func NewBotRepo(pool *pgxpool.Pool) *BotRepo { return &BotRepo{pool: pool} }

func (r *BotRepo) IsBot(ctx context.Context, userID int64) (bool, error) {
	var isBot bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT is_bot FROM users WHERE id=$1`, userID).Scan(&isBot)
	if err != nil {
		return false, nil // нет юзера — не бот (мягко)
	}
	return isBot, nil
}

func (r *BotRepo) Commands(ctx context.Context, botID int64) ([]domain.BotCommand, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT command, description FROM bot_commands WHERE bot_id=$1 ORDER BY sort, command`, botID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.BotCommand
	for rows.Next() {
		var c domain.BotCommand
		if e := rows.Scan(&c.Command, &c.Description); e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
