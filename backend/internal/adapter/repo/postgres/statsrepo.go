package postgres

import (
	"context"
	"errors"
	"time"

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

// SeqBefore — последний номер не удалённого сообщения чата с seq не выше
// maxSeq, созданного строго до t; 0 — если такого нет. Индекса
// messages(chat_id, created_at) нет, поэтому граница окна по времени
// переводится в границу по seq: он почти монотонен по времени (расхождение —
// длительность транзакции отправки, для окон в сутки пренебрежимо).
// Обратный скан уникального индекса (chat_id, seq) идёт от maxSeq вниз и
// проходит только сообщения новее t, то есть окно; deleted_at и created_at
// проверяются по строке кучи, так что цена линейна по размеру окна
// (EXPLAIN — handoff-2026-10-11/scratchpad/f6-stats-explain2.txt).
func (r *StatsRepo) SeqBefore(ctx context.Context, chatID, maxSeq int64, t time.Time) (int64, error) {
	var seq int64
	err := querier(ctx, r.pool).QueryRow(ctx, `
		SELECT seq FROM messages
		WHERE chat_id=$1 AND deleted_at IS NULL AND seq <= $2 AND created_at < $3
		ORDER BY seq DESC LIMIT 1`, chatID, maxSeq, t).Scan(&seq)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return seq, err
}

// summarySQL — обзор окна: $1 чат, $2 и $3 — границы seq постов (fromSeq, toSeq],
// $4 — конец окна только для участников (joined_at < $4); сверху посты
// ограничены лишь $3. Предикат окна записан один раз: id постов собираются в
// массив, реакции считаются пробами по idx_reactions_message (= ANY(ids)).
// Обычное соединение с reactions планировщик вправе выполнить хеш-соединением
// с полным проходом по таблице; EXPLAIN на 600k реакций — в
// handoff-2026-10-11/scratchpad/f6-stats-explain2.txt.
const summarySQL = `
	SELECT
		(SELECT count(*) FROM chat_members WHERE chat_id=$1 AND joined_at < $4),
		w.views, w.forwards,
		(SELECT count(*) FROM reactions WHERE message_id = ANY(w.ids)),
		w.posts, w.posters
	FROM (
		SELECT coalesce(sum(views),0) AS views, coalesce(sum(forwards),0) AS forwards,
		       count(*) AS posts, count(DISTINCT sender_id) AS posters,
		       coalesce(array_agg(id), '{}'::bigint[]) AS ids
		FROM messages
		WHERE chat_id=$1 AND deleted_at IS NULL AND type <> 'service' AND seq > $2 AND seq <= $3
	) w`

// Summary — числовой обзор окна: посты с seq в (fromSeq, toSeq] (не удалённые и
// не служебные) и участники, вступившие до at. Посты окна выбираются
// по диапазону seq.
//
// Участники — приближение: вышедшие и исключённые строк не имеют (членство
// стирается), поэтому «участников на начало окна» не учитывает тех, кто успел
// уйти позже; точных исторических снимков состава у нас нет.
func (r *StatsRepo) Summary(ctx context.Context, chatID, fromSeq, toSeq int64, at time.Time) (domain.ChannelStatsSummary, error) {
	var s domain.ChannelStatsSummary
	err := querier(ctx, r.pool).QueryRow(ctx, summarySQL,
		chatID, fromSeq, toSeq, at,
	).Scan(&s.Members, &s.TotalViews, &s.TotalForwards, &s.TotalReactions, &s.PostsCount, &s.PostersCount)
	return s, err
}

// NotificationsOn — вступившие до at участники с включёнными уведомлениями. Не мьютят те,
// кто не в мьюте с учётом типа чата (chatMutedSQL — та же копия
// domain.ChatMuted, что у пуша): мьют чата — колонка muted_until (миграция
// 0104; «навсегда» — to_timestamp(2147483647); NULL — наследует тип). По схеме
// `statsPercentValue` предыдущего значения нет — окна у показателя тоже нет.
// Фильтр `joined_at < at` — тот же, что у Members текущего окна: вступившие
// после at не попадают в part, но и в total. Общего снимка у двух выборок нет,
// гонка с вступлением между ними остаётся.
func (r *StatsRepo) NotificationsOn(ctx context.Context, chatID int64, at time.Time) (int64, error) {
	var n int64
	err := querier(ctx, r.pool).QueryRow(ctx, `
		SELECT count(*) FROM chat_members m JOIN chats c ON c.id = m.chat_id
		WHERE m.chat_id=$1 AND m.joined_at < $2 AND NOT `+chatMutedSQL(memberNotify), chatID, at).Scan(&n)
	return n, err
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
