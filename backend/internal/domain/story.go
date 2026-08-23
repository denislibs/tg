package domain

import "time"

// Story is a full stories row.
type Story struct {
	ID, AuthorID, MediaID int64
	Caption, Privacy      string
	CreatedAt, ExpiresAt  time.Time
	// Pinned — история закреплена в профиле (показывается всегда, в т.ч. истёкшая).
	// Edited — история редактировалась после публикации (флаг edited в tweb).
	Pinned, Edited bool
	// MediaAreas — интерактивные области поверх истории (tweb media_areas).
	MediaAreas []StoryMediaArea
	// FwdFrom — ссылка на исходную историю при репосте (tweb fwd_from); nil у оригинала.
	FwdFrom *StoryFwd
}

// StoryAreaCoordinates — положение области на истории в процентах (0..100),
// как tweb mediaAreaCoordinates (rotation в градусах).
type StoryAreaCoordinates struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	W        float64 `json:"w"`
	H        float64 `json:"h"`
	Rotation float64 `json:"rotation"`
}

// StoryMediaArea — интерактивная область поверх истории (tweb MediaArea).
// Type: geo|venue|reaction|url. Поля заполняются по типу (omitempty), общий
// блок — координаты. Сериализуется как элемент jsonb-массива stories.media_areas.
type StoryMediaArea struct {
	Type        string               `json:"type"`
	Coordinates StoryAreaCoordinates `json:"coordinates"`
	// geo/venue: координаты точки; venue дополнительно несёт title/address.
	Lat  *float64 `json:"lat,omitempty"`
	Long *float64 `json:"long,omitempty"`
	// Title — geo/venue (подпись точки); Address — venue.
	Title   string `json:"title,omitempty"`
	Address string `json:"address,omitempty"`
	// reaction (tweb mediaAreaSuggestedReaction): эмодзи + флаги оформления.
	Reaction string `json:"reaction,omitempty"`
	Dark     bool   `json:"dark,omitempty"`
	Flipped  bool   `json:"flipped,omitempty"`
	// url (tweb mediaAreaUrl).
	URL string `json:"url,omitempty"`
}

// StoryFwd — ссылка репоста на исходную историю (tweb fwd_from): автор и id
// оригинала.
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
	Caption     string
	// Privacy отдаётся как есть, чтобы фронт показал иконку (close friends и т.п.).
	Privacy   string
	CreatedAt time.Time
	ExpiresAt time.Time
	Viewed    bool
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
	// MediaAreas — интерактивные области поверх истории (tweb media_areas).
	MediaAreas []StoryMediaArea
	// FwdFrom — ссылка на исходную историю при репосте (tweb fwd_from); nil у оригинала.
	FwdFrom *StoryFwd
}

// StoryGroup bundles an author's active stories for the feed read model.
type StoryGroup struct {
	Author  UserReal
	Stories []StoryRecord
}

// StealthMode — эфемерное состояние «невидимого просмотра» историй пользователя
// (tweb stories.stealthMode: active_until_date / cooldown_until_date). Пока
// now < ActiveUntil, просмотры зрителя не записываются; повторно активировать
// режим можно только после CooldownUntil.
type StealthMode struct {
	ActiveUntil   time.Time
	CooldownUntil time.Time
}
