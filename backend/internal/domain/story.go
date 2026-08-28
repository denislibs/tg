package domain

import "time"

// Story is a full stories row.
type Story struct {
	ID, AuthorID, MediaID int64
	// Seq — номер истории ВНУТРИ автора: то, чем она адресуется снаружи.
	// Внутренний ключ строки (`ID`) наружу не выходит — приём и причина те же,
	// что у сообщения (`messages.seq` против `messages.id`).
	Seq                  int64
	Caption, Privacy     string
	CreatedAt, ExpiresAt time.Time
	// Pinned — история закреплена в профиле (показывается всегда, в т.ч. истёкшая).
	// Edited — история редактировалась после публикации (флаг edited в tweb).
	Pinned, Edited bool
	// MediaAreas — интерактивные области поверх истории (`Vector<MediaArea>`).
	MediaAreas MediaAreas
	// FwdFrom — ссылка на исходную историю при репосте (tweb fwd_from); nil у оригинала.
	FwdFrom *StoryFwd
}

// StoryFwd — ссылка репоста на исходную историю (tweb fwd_from): автор и НОМЕР
// оригинала внутри него. Глобального ключа здесь нет: на проводе
// `storyFwdHeader{from, story_id}` адресует пиром плюс номером.
type StoryFwd struct {
	AuthorID int64
	StoryID  int64
}

// StoryOrigin — минимальные данные исходной истории для репоста (переиспользуем
// media) и share в чаты (атрибуция по имени автора). domain.ErrNotFound если нет.
type StoryOrigin struct {
	AuthorID   int64
	AuthorName string
	MediaID    int64
}

// StoryRecord — ПЛОСКАЯ строка выборки историй: то, что отдаёт SQL, вместе с
// пер-зрительским состоянием (просмотрено, моя реакция).
//
// Суффикс Record — тот же приём и та же причина, что у DialogRecord/UserRecord/
// ChatRecord: `StoryItem` это имя ОБЪЕДИНЕНИЯ схемы (mtstory.go), и плоская
// строка выборки объединением не является. Разбор полей (что куда уезжает) —
// docs/readiness/tl-stories-analysis.md, исполняется шагом B.
type StoryRecord struct {
	ID, MediaID int64
	// Seq — номер внутри автора; наружу едет он, а не ключ строки.
	Seq     int64
	Caption string
	// Privacy отдаётся как есть, чтобы фронт показал иконку (close friends и т.п.).
	Privacy   string
	CreatedAt time.Time
	ExpiresAt time.Time
	// Pinned/Edited — состояние жизненного цикла истории (закреп в профиле / правка).
	Pinned, Edited bool
	// ReactionsCount — всего реакций на историю; MyReaction — эмодзи текущего
	// зрителя ("" = не реагировал); Reactions — разбивка эмодзи→count.
	ReactionsCount int
	MyReaction     string
	Reactions      []ReactionCount
	// AllowIDs — явный allow-лист истории с privacy=="selected". Заполняется
	// только для собственных историй зрителя (автор==зритель), чтобы автор мог
	// отредактировать аудиторию; для чужих историй остаётся nil (не раскрываем).
	AllowIDs []int64
	// MediaAreas — интерактивные области поверх истории (`Vector<MediaArea>`).
	MediaAreas MediaAreas
	// FwdFrom — ссылка на исходную историю при репосте (tweb fwd_from); nil у оригинала.
	FwdFrom *StoryFwd
	// Media — ВЛОЖЕНИЕ истории ступенью (`storyItem.media`). В строке `stories`
	// его нет: там лежит только номер файла, а метаданные — в `media`. Поле
	// вычисляемое, наполняет его read-модель (usecase/story) тем же приёмом,
	// каким `DialogRecord` получает последнее сообщение.
	Media MessageMedia
}

// StoryViewers — просмотры истории вместе с карточками зрителей: ровно то, из
// чего собирается контейнер `stories.storyViewsList`.
//
// Прежде наружу ехали ГОЛЫЕ карточки, и вместе с ними терялись оба параметра
// `storyView`: когда посмотрел (предмет есть — `story_views.viewed_at`) и чем
// отреагировал.
type StoryViewers struct {
	Views []StoryView
	Users []UserReal
}

// StoryGroup bundles an author's active stories for the feed read model.
type StoryGroup struct {
	Author  UserReal
	Stories []StoryRecord
	// MaxReadID — ГОРИЗОНТ прочтения зрителя у этого автора
	// (`peerStories.max_read_id`). Один номер на автора вместо признака на
	// каждой истории: «непрочитанная» это `story.id > MaxReadID`, и выводит это
	// клиент — ровно как непрочитанность сообщения по `read_inbox_max_id`.
	MaxReadID int64
}

// StealthMode — эфемерное состояние «невидимого просмотра» историй пользователя
// (tweb stories.stealthMode: active_until_date / cooldown_until_date). Пока
// now < ActiveUntil, просмотры зрителя не записываются; повторно активировать
// режим можно только после CooldownUntil.
type StealthMode struct {
	ActiveUntil   time.Time
	CooldownUntil time.Time
}
