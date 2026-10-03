package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasestats "github.com/messenger-denis/backend/internal/usecase/stats"
)

// StatsRepo реализует stats.Repo — считает серии статистики канала на лету из
// таблиц messages / chat_members / message_views (реальные данные, без снапшотов).
type StatsRepo struct{ pool *pgxpool.Pool }

// NewStatsRepo создаёт репозиторий статистики.
func NewStatsRepo(pool *pgxpool.Pool) *StatsRepo { return &StatsRepo{pool: pool} }

var _ usecasestats.Repo = (*StatsRepo)(nil)

func (r *StatsRepo) ChatType(ctx context.Context, chatID int64) (string, error) {
	var typ string
	err := querier(ctx, r.pool).QueryRow(ctx, `SELECT type FROM chats WHERE id=$1`, chatID).Scan(&typ)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return typ, err
}

func (r *StatsRepo) MemberRole(ctx context.Context, chatID, userID int64) (string, domain.Rights, error) {
	var role string
	var rights domain.Rights
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT role, rights FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID,
	).Scan(&role, &rights)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, domain.ErrNotFound
	}
	return role, rights, err
}

// Summary — числовой обзор. Уведомления включены у тех, кто не в мьюте:
// мьют — единственная колонка muted_until (миграция 0104; «навсегда» —
// to_timestamp(2147483647)).
func (r *StatsRepo) Summary(ctx context.Context, chatID int64) (domain.ChannelStatsSummary, error) {
	var s domain.ChannelStatsSummary
	err := querier(ctx, r.pool).QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM chat_members WHERE chat_id=$1),
			(SELECT coalesce(sum(views),0) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL),
			(SELECT coalesce(sum(forwards),0) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL),
			(SELECT count(*) FROM reactions r JOIN messages m ON m.id = r.message_id
			  WHERE m.chat_id=$1 AND m.deleted_at IS NULL),
			(SELECT count(*) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL AND type <> 'service'),
			(SELECT count(*) FROM chat_members WHERE chat_id=$1
			  AND (muted_until IS NULL OR muted_until <= now()))`,
		chatID,
	).Scan(&s.Members, &s.TotalViews, &s.TotalForwards, &s.TotalReactions, &s.PostsCount, &s.NotificationsOn)
	return s, err
}

// dailySeries выполняет запрос вида «SELECT day::date, count/sum GROUP BY day
// ORDER BY day» и собирает точки ряда.
func (r *StatsRepo) dailySeries(ctx context.Context, sql string, chatID int64) ([]domain.StatPoint, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, sql, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	points := make([]domain.StatPoint, 0)
	for rows.Next() {
		var p domain.StatPoint
		if err := rows.Scan(&p.Day, &p.Value); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

func (r *StatsRepo) MembersByDay(ctx context.Context, chatID int64) ([]domain.StatPoint, error) {
	return r.dailySeries(ctx, `
		SELECT joined_at::date AS day, count(*)
		FROM chat_members WHERE chat_id=$1
		GROUP BY day ORDER BY day`, chatID)
}

func (r *StatsRepo) ViewsByDay(ctx context.Context, chatID int64) ([]domain.StatPoint, error) {
	return r.dailySeries(ctx, `
		SELECT mv.viewed_at::date AS day, count(*)
		FROM message_views mv
		JOIN messages m ON m.id = mv.message_id
		WHERE m.chat_id=$1
		GROUP BY day ORDER BY day`, chatID)
}

func (r *StatsRepo) PostsByDay(ctx context.Context, chatID int64) ([]domain.StatPoint, error) {
	return r.dailySeries(ctx, `
		SELECT created_at::date AS day, count(*)
		FROM messages WHERE chat_id=$1 AND deleted_at IS NULL AND type <> 'service'
		GROUP BY day ORDER BY day`, chatID)
}

func (r *StatsRepo) PostExists(ctx context.Context, chatID, msgID int64) (bool, error) {
	var ok bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM messages WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL)`,
		msgID, chatID).Scan(&ok)
	return ok, err
}

func (r *StatsRepo) PostViewsByDay(ctx context.Context, msgID int64) ([]domain.StatPoint, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, `
		SELECT viewed_at::date AS day, count(*)
		FROM message_views WHERE message_id=$1
		GROUP BY day ORDER BY day`, msgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	points := make([]domain.StatPoint, 0)
	for rows.Next() {
		var p domain.StatPoint
		if err := rows.Scan(&p.Day, &p.Value); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

// RecentPosts — последние посты канала (без служебных) со счётчиками
// взаимодействий: просмотры
// и пересылки — счётчики самого поста, реакции — число строк reactions.
func (r *StatsRepo) RecentPosts(ctx context.Context, chatID int64, limit int) ([]domain.RecentPost, error) {
	rows, err := querier(ctx, r.pool).Query(ctx, `
		SELECT m.seq, m.views, m.forwards,
			(SELECT count(*) FROM reactions r WHERE r.message_id = m.id)
		FROM messages m
		WHERE m.chat_id=$1 AND m.deleted_at IS NULL AND m.type <> 'service'
		ORDER BY m.id DESC
		LIMIT $2`, chatID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	posts := make([]domain.RecentPost, 0, limit)
	for rows.Next() {
		var p domain.RecentPost
		if err := rows.Scan(&p.Seq, &p.Views, &p.Forwards, &p.Reactions); err != nil {
			return nil, err
		}
		posts = append(posts, p)
	}
	return posts, rows.Err()
}
