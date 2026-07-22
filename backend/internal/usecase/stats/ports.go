package stats

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// Repo — источник данных статистики канала. Все ряды считаются на лету из
// реальных таблиц (messages / chat_members / message_views), снапшоты не нужны.
type Repo interface {
	// ChatType возвращает тип чата ('channel'|'group'|...); domain.ErrNotFound,
	// если чата нет.
	ChatType(ctx context.Context, chatID int64) (string, error)
	// MemberRole возвращает роль и права участника; domain.ErrNotFound, если
	// пользователь не участник чата.
	MemberRole(ctx context.Context, chatID, userID int64) (role string, rights domain.Rights, err error)
	// Summary — числовой обзор (без вычисляемого AvgReach — его считает usecase).
	Summary(ctx context.Context, chatID int64) (domain.ChannelStatsSummary, error)
	// MembersByDay — число присоединившихся по дням (chat_members.joined_at),
	// возрастающе по дате. Кумулятив считает usecase.
	MembersByDay(ctx context.Context, chatID int64) ([]domain.StatPoint, error)
	// ViewsByDay — просмотры по дням (message_views.viewed_at), возрастающе.
	ViewsByDay(ctx context.Context, chatID int64) ([]domain.StatPoint, error)
	// PostsByDay — число постов по дням (messages.created_at), возрастающе.
	PostsByDay(ctx context.Context, chatID int64) ([]domain.StatPoint, error)
	// TopPosts — до limit постов, отсортированных по просмотрам (по убыванию).
	TopPosts(ctx context.Context, chatID int64, limit int) ([]domain.TopPost, error)

	// PostExists сообщает, есть ли в чате не удалённый пост с таким id.
	PostExists(ctx context.Context, chatID, msgID int64) (bool, error)
	// PostOverview — счётчики поста: просмотры (messages.views) и пересылки
	// (messages.forwards).
	PostOverview(ctx context.Context, chatID, msgID int64) (views, forwards int64, err error)
	// PostReactions — разбивка реакций поста по эмодзи (reactions), по убыванию
	// количества.
	PostReactions(ctx context.Context, msgID int64) ([]domain.ReactionCount, error)
	// PostViewsByDay — просмотры поста по дням (message_views.viewed_at), возрастающе.
	PostViewsByDay(ctx context.Context, msgID int64) ([]domain.StatPoint, error)
}
