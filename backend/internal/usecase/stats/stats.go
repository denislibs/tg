// Package stats — статистика каналов/супергрупп (аналог tweb stats.getBroadcastStats).
// Все серии считаются на лету из реальных данных: посты по дням из
// messages.created_at, просмотры по дням из message_views, рост участников —
// кумулятивно по chat_members.joined_at. Ничего не выдумывается и не снапшотится.
package stats

import (
	"context"
	"math"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// recentPostsLimit — сколько недавних постов отдавать в recent_posts_interactions.
const recentPostsLimit = 20

// Interactor — сбор статистики канала.
type Interactor struct {
	repo Repo
	now  func() time.Time
}

// New создаёт usecase статистики.
func New(repo Repo) *Interactor { return &Interactor{repo: repo, now: time.Now} }

// ChannelStats собирает полную статистику канала для админа/владельца.
// Доступ есть только у создателя и админов канала/супергруппы (как can_view_stats
// в Telegram). Для остальных типов чатов и не-админов — domain.ErrForbidden.
func (i *Interactor) ChannelStats(ctx context.Context, chatID, userID int64) (domain.ChannelStats, error) {
	typ, err := i.repo.ChatType(ctx, chatID)
	if err != nil {
		return domain.ChannelStats{}, err
	}
	// Статистика есть у каналов и (супер)групп; у приватных/saved — нет.
	if typ != "channel" && typ != "group" {
		return domain.ChannelStats{}, domain.ErrForbidden
	}

	role, _, err := i.repo.MemberRole(ctx, chatID, userID)
	if err != nil {
		return domain.ChannelStats{}, domain.ErrForbidden
	}
	if role != domain.RoleCreator && role != domain.RoleAdmin {
		return domain.ChannelStats{}, domain.ErrForbidden
	}

	at := i.now()
	summary, previous, notificationsOn, err := i.overview(ctx, chatID, at)
	if err != nil {
		return domain.ChannelStats{}, err
	}

	membersDaily, err := i.repo.MembersByDay(ctx, chatID)
	if err != nil {
		return domain.ChannelStats{}, err
	}
	views, err := i.repo.ViewsByDay(ctx, chatID)
	if err != nil {
		return domain.ChannelStats{}, err
	}
	posts, err := i.repo.PostsByDay(ctx, chatID)
	if err != nil {
		return domain.ChannelStats{}, err
	}
	recent, err := i.repo.RecentPosts(ctx, chatID, recentPostsLimit)
	if err != nil {
		return domain.ChannelStats{}, err
	}

	return domain.ChannelStats{
		Broadcast:       typ == "channel",
		At:              at,
		Summary:         summary,
		Previous:        previous,
		NotificationsOn: notificationsOn,
		MembersGrowth:   cumulative(membersDaily),
		JoinedByDay:     membersDaily,
		ViewsByDay:      views,
		PostsByDay:      posts,
		RecentPosts:     recent,
	}, nil
}

// overview — числа обзора за два окна по 7 дней: текущее [at−7д, at) и
// предыдущее [at−14д, at−7д). Границы по времени переводятся в границы по seq
// (по одной выборке на границу — индекса по created_at нет), дальше оба окна
// считаются по диапазону seq. Окно публикаций — по моменту создания поста,
// участники — по `joined_at` на конец окна.
func (i *Interactor) overview(ctx context.Context, chatID int64, at time.Time) (current, previous domain.ChannelStatsSummary, notificationsOn int64, err error) {
	mid := at.Add(-domain.StatsWindow)
	seqMid, err := i.repo.SeqBefore(ctx, chatID, math.MaxInt64, mid)
	if err != nil {
		return
	}
	// Скан второй границы начинается с seqMid: читается только предыдущее окно.
	seqStart, err := i.repo.SeqBefore(ctx, chatID, seqMid, mid.Add(-domain.StatsWindow))
	if err != nil {
		return
	}
	if current, err = i.repo.Summary(ctx, chatID, seqMid, math.MaxInt64, at); err != nil {
		return
	}
	if previous, err = i.repo.Summary(ctx, chatID, seqStart, seqMid, mid); err != nil {
		return
	}
	notificationsOn, err = i.repo.NotificationsOn(ctx, chatID, at)
	return
}

// PostStats собирает статистику одного поста канала (stats.getMessageStats).
// Доступ — как у ChannelStats: создатель/админ канала или (супер)группы. Ряд
// просмотров считается на лету из реальных данных.
func (i *Interactor) PostStats(ctx context.Context, chatID, msgID, userID int64) (domain.PostStats, error) {
	typ, err := i.repo.ChatType(ctx, chatID)
	if err != nil {
		return domain.PostStats{}, err
	}
	if typ != "channel" && typ != "group" {
		return domain.PostStats{}, domain.ErrForbidden
	}

	role, _, err := i.repo.MemberRole(ctx, chatID, userID)
	if err != nil {
		return domain.PostStats{}, domain.ErrForbidden
	}
	if role != domain.RoleCreator && role != domain.RoleAdmin {
		return domain.PostStats{}, domain.ErrForbidden
	}

	exists, err := i.repo.PostExists(ctx, chatID, msgID)
	if err != nil {
		return domain.PostStats{}, err
	}
	if !exists {
		return domain.PostStats{}, domain.ErrNotFound
	}

	viewsByDay, err := i.repo.PostViewsByDay(ctx, msgID)
	if err != nil {
		return domain.PostStats{}, err
	}
	return domain.PostStats{ViewsByDay: viewsByDay}, nil
}

// cumulative превращает суточные приросты в кумулятивный ряд (рост участников):
// каждая точка = сумма всех предыдущих значений включительно.
func cumulative(points []domain.StatPoint) []domain.StatPoint {
	out := make([]domain.StatPoint, len(points))
	var running int64
	for idx, p := range points {
		running += p.Value
		out[idx] = domain.StatPoint{Day: p.Day, Value: running}
	}
	return out
}
