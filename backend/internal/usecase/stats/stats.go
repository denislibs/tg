// Package stats — статистика каналов/супергрупп (аналог tweb stats.getBroadcastStats).
// Все серии считаются на лету из реальных данных: посты по дням из
// messages.created_at, просмотры по дням из message_views, рост участников —
// кумулятивно по chat_members.joined_at. Ничего не выдумывается и не снапшотится.
package stats

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// topPostsLimit — сколько постов показывать в топе по просмотрам.
const topPostsLimit = 10

// Interactor — сбор статистики канала.
type Interactor struct{ repo Repo }

// New создаёт usecase статистики.
func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

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

	summary, err := i.repo.Summary(ctx, chatID)
	if err != nil {
		return domain.ChannelStats{}, err
	}
	if summary.PostsCount > 0 {
		summary.AvgReach = summary.TotalViews / summary.PostsCount
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
	top, err := i.repo.TopPosts(ctx, chatID, topPostsLimit)
	if err != nil {
		return domain.ChannelStats{}, err
	}

	return domain.ChannelStats{
		Summary:       summary,
		MembersGrowth: cumulative(membersDaily),
		ViewsByDay:    views,
		PostsByDay:    posts,
		TopPosts:      top,
	}, nil
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
