package story

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// StoryRepo is the persistence port for stories: post, the active feed read
// model (with privacy/visibility filtering and per-viewer seen state), view
// tracking, viewers list, author lookup, deletion, and a single-story
// visibility check.
type StoryRepo interface {
	Create(ctx context.Context, s domain.Story, allowIDs []int64) (int64, error)
	ActiveFeed(ctx context.Context, viewerID int64, authorIDs []int64) ([]domain.StoryGroup, error)
	MarkViewed(ctx context.Context, storyID, viewerID int64) error
	Viewers(ctx context.Context, storyID int64) ([]domain.UserCard, error)
	// Stats — статистика истории (просмотры + динамика по дням из story_views).
	Stats(ctx context.Context, storyID int64) (domain.StoryStats, error)
	GetAuthor(ctx context.Context, storyID int64) (int64, error) // domain.ErrNotFound
	Delete(ctx context.Context, storyID, authorID int64) error
	Visible(ctx context.Context, storyID, viewerID int64, partnerIDs []int64) (bool, error)
	// SetReaction ставит/меняет реакцию пользователя на историю (upsert по
	// PRIMARY KEY(story_id,user_id)); RemoveReaction снимает её.
	SetReaction(ctx context.Context, storyID, userID int64, reaction string) error
	RemoveReaction(ctx context.Context, storyID, userID int64) error
	// ReactionsCount — всего реакций на историю (для живого счётчика в WS-событии).
	ReactionsCount(ctx context.Context, storyID int64) (int, error)

	// CloseFriends возвращает id близких друзей владельца; SetCloseFriends
	// полностью заменяет список (delete-all + insert в транзакции).
	CloseFriends(ctx context.Context, ownerID int64) ([]int64, error)
	SetCloseFriends(ctx context.Context, ownerID int64, userIDs []int64) error

	// SetPinned переключает закреп истории в профиле (только владелец через WHERE
	// author_id). Edit меняет caption/privacy (nil = не трогать), ставит edited=true
	// и синхронизирует story_allow под новую privacy.
	SetPinned(ctx context.Context, storyID, authorID int64, pinned bool) error
	Edit(ctx context.Context, storyID, authorID int64, caption, privacy *string, allowIDs []int64) error

	// AllowIDs возвращает явный allow-лист истории (story_allow) для privacy=="selected".
	AllowIDs(ctx context.Context, storyID int64) ([]int64, error)

	// Archive — свои истёкшие истории (expires_at <= now), новые сверху, с
	// пагинацией по id (offsetID>0 — только id < offsetID). Pinned — закреплённые
	// истории peer'а (в т.ч. истёкшие), отфильтрованные по видимости для viewer.
	Archive(ctx context.Context, ownerID, limit, offsetID int64) ([]domain.StoryItem, error)
	Pinned(ctx context.Context, peerID, viewerID int64) ([]domain.StoryItem, error)

	// PurgeRecentViews удаляет просмотры зрителя за окно [since, now] — ретро-эффект
	// stealth-режима (past): скрыть недавние просмотры при активации.
	PurgeRecentViews(ctx context.Context, viewerID int64, since time.Time) error
}

// StealthStore хранит эфемерное состояние stealth-режима пользователя (Redis).
// Опционален: когда nil, stealth-фича отключена (View всегда пишет просмотр).
type StealthStore interface {
	// Get возвращает текущее состояние; zero-value, если режим не активировался.
	Get(ctx context.Context, userID int64) (domain.StealthMode, error)
	// Set сохраняет состояние с TTL до max(ActiveUntil, CooldownUntil).
	Set(ctx context.Context, userID int64, mode domain.StealthMode) error
}

// Partners resolves the set of users that share a chat with a viewer; satisfied
// by the chat usecase's ChatPartners.
type Partners interface {
	ChatPartners(ctx context.Context, userID int64) ([]int64, error)
}

// MediaOwner resolves the owner of a media object; satisfied by the postgres
// MediaAccessRepo.
type MediaOwner interface {
	OwnerID(ctx context.Context, mediaID int64) (int64, error)
}

// TxManager runs fn inside a transaction; the tx is carried in the returned ctx
// (repo adapters pick it up). Same shape as the chat usecase's TxManager.
type TxManager interface {
	WithinTx(ctx context.Context, fn func(ctx context.Context) error) error
}

// EventPublisher рассылает realtime-кадры историй адресатам (по образцу chat).
// Опционален: когда nil, истории живут только через polling GET /stories.
type EventPublisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}
