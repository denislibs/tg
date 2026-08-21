// Package stickers — usecase стикеров и GIF: наборы, установка, недавние и
// избранные стикеры, сохранённые GIF, поиск GIF во внешнем провайдере.
package stickers

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// Repo — хранилище стикеров/наборов/GIF. Лимиты (keep) диктует usecase, чтобы
// правила «сколько хранить» жили в бизнес-логике, а обрезка — одним SQL.
type Repo interface {
	// CreateSet создаёт набор; занятый slug → domain.ErrConflict.
	CreateSet(ctx context.Context, set domain.StickerSetRecord) (domain.StickerSetRecord, error)
	SetBySlug(ctx context.Context, slug string) (domain.StickerSetRecord, error) // domain.ErrNotFound
	SetByID(ctx context.Context, id int64) (domain.StickerSetRecord, error)      // domain.ErrNotFound
	Stickers(ctx context.Context, setID int64) ([]domain.Sticker, error)
	// AddSticker добавляет стикер в конец набора (position назначает хранилище).
	AddSticker(ctx context.Context, s domain.Sticker) (domain.Sticker, error)
	// AddStickerAt добавляет стикер на явную позицию — использует сид
	// (cmd/seed-stickers), где позиция берётся из meta.json и обязана
	// совпасть с БД; AddSticker с автопозицией для этого не годится, так как
	// при дыре в середине набора всегда аппендит в хвост, а не в дыру.
	// pathThumb — контур стикера (domain.Sticker.PathThumb), едет со вставкой.
	AddStickerAt(ctx context.Context, setID, mediaID int64, emoji string, position int, pathThumb []byte) (domain.Sticker, error)
	// StickerByMediaID — стикер по КЛЮЧУ ФАЙЛА (document.id схемы). Поиска по
	// суррогатному ключу строки больше нет: наружу он не выходит (Р2).
	StickerByMediaID(ctx context.Context, mediaID int64) (domain.Sticker, error) // domain.ErrNotFound

	Install(ctx context.Context, userID, setID int64) error   // идемпотентно
	Uninstall(ctx context.Context, userID, setID int64) error // идемпотентно
	// InstalledSets — установленные наборы пользователя по position.
	InstalledSets(ctx context.Context, userID int64) ([]domain.StickerSetRecord, error)
	SearchSets(ctx context.Context, q string, limit int) ([]domain.StickerSetRecord, error)
	// FeaturedSets — «трендовые» наборы: по рангу (порядок Telegram-выдачи),
	// затем наборы без ранга новейшими первыми; не больше limit.
	FeaturedSets(ctx context.Context, limit int) ([]domain.StickerSetRecord, error)
	// CoverStickers — превью первых perSet стикеров каждого набора из setIDs,
	// ОДНИМ запросом на всю выдачу (covered sets Telegram): экран поиска
	// показывает сотни наборов разом, по SetBySlug на строку — N+1. Наборов
	// без стикеров в карте нет.
	CoverStickers(ctx context.Context, setIDs []int64, perSet int) (map[int64][]domain.Sticker, error)
	// SetRank проставляет позицию набора в трендах (0 — вне трендов).
	SetRank(ctx context.Context, setID int64, rank int) error
	// SetCover привязывает медиа обложки к набору.
	SetCover(ctx context.Context, setID, mediaID int64) error
	// StickerPositions — занятые позиции набора; сид (cmd/seed-stickers)
	// использует их, чтобы досидировать только недостающие стикеры, не трогая
	// существующие.
	StickerPositions(ctx context.Context, setID int64) (map[int]struct{}, error)
	// BackfillPathThumbs дозаписывает контур уже существующим стикерам набора
	// по позиции — сид использует его, чтобы контур доехал и до стикеров,
	// залитых раньше появления этого поля. Уже проставленный контур не
	// трогает (см. StickersRepo.BackfillPathThumbs).
	BackfillPathThumbs(ctx context.Context, setID int64, thumbs map[int][]byte) error

	// TouchRecent — upsert used_at=now() + обрезка списка до keep новейших.
	TouchRecent(ctx context.Context, userID, mediaID int64, keep int) error
	Recent(ctx context.Context, userID int64, limit int) ([]domain.Sticker, error)
	// ClearRecent — стереть весь список недавних пользователя; идемпотентно.
	ClearRecent(ctx context.Context, userID int64) error
	// Fave — upsert + обрезка до keep новейших; Unfave идемпотентен.
	Fave(ctx context.Context, userID, mediaID int64, keep int) error
	Unfave(ctx context.Context, userID, mediaID int64) error
	Faved(ctx context.Context, userID int64, limit int) ([]domain.Sticker, error)
	// SearchByEmoji — стикеры с данным эмодзи из установленных наборов userID.
	SearchByEmoji(ctx context.Context, userID int64, emoji string, limit int) ([]domain.Sticker, error)

	SavedGifs(ctx context.Context, userID int64) ([]domain.SavedGif, error)
	// SaveGif — upsert saved_at=now() + обрезка до keep новейших (LIFO).
	SaveGif(ctx context.Context, userID, mediaID int64, keep int) error
	DeleteGif(ctx context.Context, userID, mediaID int64) error

	MediaExists(ctx context.Context, mediaID int64) (bool, error)
	// IsStickerMedia — media принадлежит какому-либо стикеру (наборы публичны,
	// поэтому такое media можно слать и читать всем).
	IsStickerMedia(ctx context.Context, mediaID int64) (bool, error)
}

// GifSearcher — внешний поиск GIF (Tenor). Опционален: без него поиск отдаёт
// пустую страницу, остальные фичи работают.
type GifSearcher interface {
	SearchGifs(ctx context.Context, q, pos string, limit int) (GifPage, error)
}

// Gif — нормализованный результат внешнего поиска (независим от провайдера).
type Gif struct {
	ID         string `json:"id"`
	MP4URL     string `json:"mp4_url"`
	GifURL     string `json:"gif_url"`
	PreviewURL string `json:"preview_url"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
}

// GifPage — страница результатов; Next — курсор следующей страницы (pos).
type GifPage struct {
	Gifs []Gif  `json:"gifs"`
	Next string `json:"next"`
}
