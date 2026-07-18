package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// PollsRepo хранит опросы и голоса (таблицы polls / poll_votes).
type PollsRepo struct {
	pool *pgxpool.Pool
}

func NewPollsRepo(pool *pgxpool.Pool) *PollsRepo { return &PollsRepo{pool: pool} }

func (r *PollsRepo) Create(ctx context.Context, p domain.Poll) (domain.Poll, error) {
	opts, err := json.Marshal(p.Options)
	if err != nil {
		return domain.Poll{}, err
	}
	err = querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO polls (chat_id, question, options, anonymous, multiple, quiz, correct_option)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
		p.ChatID, p.Question, string(opts), p.Anonymous, p.Multiple, p.Quiz, p.CorrectOption).Scan(&p.ID)
	return p, err
}

func (r *PollsRepo) ByID(ctx context.Context, id int64) (domain.Poll, error) {
	var p domain.Poll
	var optsRaw []byte
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, chat_id, question, options, anonymous, multiple, quiz, correct_option, closed
		   FROM polls WHERE id=$1`, id).
		Scan(&p.ID, &p.ChatID, &p.Question, &optsRaw, &p.Anonymous, &p.Multiple, &p.Quiz, &p.CorrectOption, &p.Closed)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Poll{}, domain.ErrNotFound
	}
	if err == nil {
		_ = json.Unmarshal(optsRaw, &p.Options)
	}
	return p, err
}

// SetVotes заменяет голос пользователя целиком (multiple пишет несколько
// строк; пустой список = отзыв голоса).
func (r *PollsRepo) SetVotes(ctx context.Context, pollID, userID int64, optionIdxs []int) error {
	q := querier(ctx, r.pool)
	if _, err := q.Exec(ctx, `DELETE FROM poll_votes WHERE poll_id=$1 AND user_id=$2`, pollID, userID); err != nil {
		return err
	}
	for _, idx := range optionIdxs {
		if _, err := q.Exec(ctx,
			`INSERT INTO poll_votes (poll_id, user_id, option_idx) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
			pollID, userID, idx); err != nil {
			return err
		}
	}
	return nil
}

// HasVoted — голосовал ли пользователь (для запрета переголосования в викторине).
func (r *PollsRepo) HasVoted(ctx context.Context, pollID, userID int64) (bool, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM poll_votes WHERE poll_id=$1 AND user_id=$2`, pollID, userID).Scan(&n)
	return n > 0, err
}

func (r *PollsRepo) Close(ctx context.Context, pollID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx, `UPDATE polls SET closed=true WHERE id=$1`, pollID)
	return err
}

// Info собирает представление опроса для зрителя: агрегаты голосов + его выбор.
// CorrectOption раскрывается интерактором, здесь возвращается как есть.
func (r *PollsRepo) Info(ctx context.Context, pollID, viewerID int64) (domain.PollInfo, error) {
	p, err := r.ByID(ctx, pollID)
	if err != nil {
		return domain.PollInfo{}, err
	}
	info := domain.PollInfo{
		ID: p.ID, Question: p.Question, Options: p.Options,
		Anonymous: p.Anonymous, Multiple: p.Multiple, Quiz: p.Quiz, Closed: p.Closed,
		CorrectOption: p.CorrectOption,
		Counts:        make([]int, len(p.Options)),
		MyVotes:       []int{},
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT option_idx, count(*), bool_or(user_id=$2) FROM poll_votes WHERE poll_id=$1 GROUP BY option_idx`,
		pollID, viewerID)
	if err != nil {
		return domain.PollInfo{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var idx, cnt int
		var mine bool
		if e := rows.Scan(&idx, &cnt, &mine); e != nil {
			return domain.PollInfo{}, e
		}
		if idx >= 0 && idx < len(info.Counts) {
			info.Counts[idx] = cnt
			if mine {
				info.MyVotes = append(info.MyVotes, idx)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return domain.PollInfo{}, err
	}
	if err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(DISTINCT user_id) FROM poll_votes WHERE poll_id=$1`, pollID).Scan(&info.TotalVoters); err != nil {
		return domain.PollInfo{}, err
	}
	return info, nil
}
