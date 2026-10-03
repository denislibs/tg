package domain

import "time"

// StatPoint — одна точка временного ряда статистики: сутки + значение.
// Ряды строятся из реальных данных (даты сообщений/присоединений/просмотров),
// ничего не выдумывается.
type StatPoint struct {
	Day   time.Time
	Value int64
}

// RecentPost — недавний пост канала со счётчиками взаимодействий: строка
// `recent_posts_interactions` (`postInteractionCountersMessage`). Сам пост клиент
// догружает по номеру (tweb `statistics.tsx:1006-1015`).
type RecentPost struct {
	// Seq — адрес поста (номер в канале); второго числа у поста нет.
	Seq       int64
	Views     int64
	Forwards  int64
	Reactions int64
}

// ChannelStatsSummary — числовой обзор статистики канала/группы.
type ChannelStatsSummary struct {
	Members         int64 // текущее число подписчиков/участников
	TotalViews      int64 // суммарные просмотры всех постов
	TotalForwards   int64 // суммарные пересылки всех постов
	TotalReactions  int64 // суммарные реакции на все посты
	PostsCount      int64 // число постов (не удалённых)
	NotificationsOn int64 // участников с включёнными уведомлениями (не muted)
}

// ChannelStats — статистика канала/группы: обзор, временные ряды и недавние
// посты. Форму схемы собирают ToBroadcastWire/ToMegagroupWire (mtstats.go).
type ChannelStats struct {
	// Broadcast — канал (stats.broadcastStats); иначе группа (stats.megagroupStats).
	Broadcast     bool
	Summary       ChannelStatsSummary
	MembersGrowth []StatPoint // кумулятивный рост участников по дням
	JoinedByDay   []StatPoint // присоединившиеся по дням
	ViewsByDay    []StatPoint // просмотры по дням
	PostsByDay    []StatPoint // посты по дням
	RecentPosts   []RecentPost
}

// PostStats — статистика одного поста канала (stats.getMessageStats): динамика
// просмотров по дням (message_views.viewed_at). Числа обзора клиент берёт из
// самого сообщения.
type PostStats struct {
	ViewsByDay []StatPoint
}

// StoryStats — статистика истории (аналог tweb stats.getStoryStats): просмотры и
// их динамика по дням плюс реакции (всего + разбивка по эмодзи из
// story_reactions). Пересылок у историй в этой модели данных нет.
type StoryStats struct {
	Views          int64           // всего просмотров (уникальные зрители story_views)
	ViewsByDay     []StatPoint     // просмотры по дням (story_views.viewed_at)
	ReactionsTotal int64           // всего реакций (story_reactions)
	Reactions      []ReactionCount // разбивка реакций по эмодзи
}
