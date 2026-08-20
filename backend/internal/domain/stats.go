package domain

import "time"

// StatPoint — одна точка временного ряда статистики: сутки + значение.
// Ряды строятся из реальных данных (даты сообщений/присоединений/просмотров),
// ничего не выдумывается.
type StatPoint struct {
	Day   time.Time
	Value int64
}

// TopPost — пост канала в топе по числу просмотров.
//
// Конструктором `message` НЕ становится, и основание одно — предмет ДРУГОЙ: это
// строка АГРЕГАТА (пост + его метрика + сутки), а не сообщение. У оригинала на
// её месте stats.megagroupStats.top_posters / statsGroupTopPoster — тоже
// собственные конструкторы статистики, ссылающиеся на сообщение НОМЕРОМ, а не
// несущие его. Текст здесь — подпись строки таблицы, и его короткая выжимка
// вторым сериализатором сообщения не является.
type TopPost struct {
	// Seq — адрес поста (номер в канале); второго числа у поста нет.
	Seq       int64
	Text      string
	Views     int64
	CreatedAt time.Time
}

// ChannelStatsSummary — числовой обзор (карточки Overview) статистики канала.
type ChannelStatsSummary struct {
	Members         int64 // текущее число подписчиков/участников
	TotalViews      int64 // суммарные просмотры всех постов
	PostsCount      int64 // число постов (не удалённых)
	AvgReach        int64 // средний охват = TotalViews / PostsCount
	NotificationsOn int64 // участников с включёнными уведомлениями (не muted)
}

// ChannelStats — полная статистика канала: обзор + временные ряды + топ-посты.
type ChannelStats struct {
	Summary       ChannelStatsSummary
	MembersGrowth []StatPoint // кумулятивный рост участников по дням
	ViewsByDay    []StatPoint // просмотры по дням
	PostsByDay    []StatPoint // посты по дням
	TopPosts      []TopPost   // топ-посты по просмотрам
}

// PostStats — статистика одного поста канала (аналог tweb stats.getMessageStats):
// обзор (просмотры/пересылки/реакции), разбивка реакций по эмодзи и динамика
// просмотров по дням. Всё считается на лету из реальных данных
// (messages.views/forwards, message_views, reactions). Разбивка реакций
// переиспользует ReactionCount.
type PostStats struct {
	Views          int64           // messages.views — канонический счётчик просмотров поста
	Forwards       int64           // messages.forwards — сколько раз переслали
	ReactionsTotal int64           // сумма всех реакций (эмодзи + star)
	Reactions      []ReactionCount // разбивка реакций по эмодзи
	ViewsByDay     []StatPoint     // просмотры по дням (message_views.viewed_at)
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
