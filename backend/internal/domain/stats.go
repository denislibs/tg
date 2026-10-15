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

// StatsWindow — длина окна обзора статистики: `current` — последние 7 дней,
// `previous` — 7 дней перед ними (решение пользователя 2026-10-13).
const StatsWindow = 7 * 24 * time.Hour

// ChannelStatsSummary — числовой обзор канала/группы за одно окно.
type ChannelStatsSummary struct {
	Members        int64 // участников, вступивших до конца окна
	TotalViews     int64 // суммарные просмотры постов, опубликованных в окне
	TotalForwards  int64 // суммарные пересылки этих постов
	TotalReactions int64 // суммарные реакции на эти посты
	PostsCount     int64 // постов в окне (не удалённых, не служебных)
	PostersCount   int64 // разных авторов постов в окне
}

// ChannelStats — статистика канала/группы: обзор за два окна, временные ряды и
// недавние посты. Форму схемы собирают ToBroadcastWire/ToMegagroupWire
// (mtstats.go).
type ChannelStats struct {
	// Broadcast — канал (stats.broadcastStats); иначе группа (stats.megagroupStats).
	Broadcast bool
	// At — момент сбора: конец текущего окна, середина двух окон — At−StatsWindow.
	At time.Time
	// Summary — окно [At−7д, At), Previous — окно [At−14д, At−7д).
	Summary  ChannelStatsSummary
	Previous ChannelStatsSummary
	// NotificationsOn — участников с включёнными уведомлениями сейчас: у
	// `statsPercentValue` предыдущего значения нет.
	NotificationsOn int64
	MembersGrowth   []StatPoint // кумулятивный рост участников по дням
	JoinedByDay     []StatPoint // присоединившиеся по дням
	ViewsByDay      []StatPoint // просмотры по дням
	PostsByDay      []StatPoint // посты по дням
	RecentPosts     []RecentPost
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
