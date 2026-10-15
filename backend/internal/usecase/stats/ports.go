package stats

import (
	"context"
	"time"

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
	// SeqBefore — последний номер не удалённого сообщения чата с seq не выше
	// maxSeq, созданного строго до t; 0, если такого нет. Переводит границу
	// окна по времени в границу по seq (индекса по created_at нет).
	SeqBefore(ctx context.Context, chatID, maxSeq int64, t time.Time) (int64, error)
	// Summary — числовой обзор окна: посты с seq в (fromSeq, toSeq], участники,
	// вступившие до at.
	Summary(ctx context.Context, chatID, fromSeq, toSeq int64, at time.Time) (domain.ChannelStatsSummary, error)
	// NotificationsOn — вступивших до at участников с включёнными уведомлениями.
	NotificationsOn(ctx context.Context, chatID int64, at time.Time) (int64, error)
	// MembersByDay — число присоединившихся по дням (chat_members.joined_at),
	// возрастающе по дате. Кумулятив считает usecase.
	MembersByDay(ctx context.Context, chatID int64) ([]domain.StatPoint, error)
	// ViewsByDay — просмотры по дням (message_views.viewed_at), возрастающе.
	ViewsByDay(ctx context.Context, chatID int64) ([]domain.StatPoint, error)
	// PostsByDay — число постов по дням (messages.created_at), возрастающе.
	PostsByDay(ctx context.Context, chatID int64) ([]domain.StatPoint, error)
	// RecentPosts — до limit последних постов со счётчиками (новые первыми).
	RecentPosts(ctx context.Context, chatID int64, limit int) ([]domain.RecentPost, error)

	// PostExists сообщает, есть ли в чате не удалённый пост с таким id.
	PostExists(ctx context.Context, chatID, msgID int64) (bool, error)
	// PostViewsByDay — просмотры поста по дням (message_views.viewed_at), возрастающе.
	PostViewsByDay(ctx context.Context, msgID int64) ([]domain.StatPoint, error)
}
