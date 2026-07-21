package stickers

import (
	"context"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Лимиты хранения — как в tweb: RECENT_STICKERS_COUNT=20, избранные ~10,
// сохранённые GIF обрезаются по давности (держим 200).
const (
	recentLimit    = 20
	favedLimit     = 10
	savedGifsLimit = 200
	emojiSearchLim = 16
	setSearchLim   = 20
	gifSearchLim   = 30
	maxTitleRunes  = 64
	maxEmojiBytes  = 32
)

// slugRe — допустимый slug набора (как короткое имя аддона: t.me/addstickers/<slug>).
var slugRe = regexp.MustCompile(`^[a-z0-9_]{3,64}$`)

// Interactor — бизнес-логика стикеров/GIF поверх портов Repo и GifSearcher.
type Interactor struct {
	repo Repo
	gifs GifSearcher
}

func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

// SetGifSearch подключает внешний поиск GIF (optional; без него — пустая выдача).
func (i *Interactor) SetGifSearch(g GifSearcher) { i.gifs = g }

// MySets — установленные наборы пользователя (по position установки).
func (i *Interactor) MySets(ctx context.Context, userID int64) ([]domain.StickerSet, error) {
	return i.repo.InstalledSets(ctx, userID)
}

// SetBySlug — набор + его стикеры по slug.
func (i *Interactor) SetBySlug(ctx context.Context, slug string) (domain.StickerSet, []domain.Sticker, error) {
	set, err := i.repo.SetBySlug(ctx, slug)
	if err != nil {
		return domain.StickerSet{}, nil, err
	}
	sts, err := i.repo.Stickers(ctx, set.ID)
	return set, sts, err
}

// SetByID — набор + его стикеры по id.
func (i *Interactor) SetByID(ctx context.Context, id int64) (domain.StickerSet, []domain.Sticker, error) {
	set, err := i.repo.SetByID(ctx, id)
	if err != nil {
		return domain.StickerSet{}, nil, err
	}
	sts, err := i.repo.Stickers(ctx, set.ID)
	return set, sts, err
}

// Install добавляет набор пользователю (идемпотентно). Нет набора → ErrNotFound.
func (i *Interactor) Install(ctx context.Context, userID, setID int64) error {
	if _, err := i.repo.SetByID(ctx, setID); err != nil {
		return err
	}
	return i.repo.Install(ctx, userID, setID)
}

// Uninstall убирает набор у пользователя (идемпотентно).
func (i *Interactor) Uninstall(ctx context.Context, userID, setID int64) error {
	return i.repo.Uninstall(ctx, userID, setID)
}

// SearchSets ищет наборы по title/slug (ilike). Пустой запрос — пустая выдача.
func (i *Interactor) SearchSets(ctx context.Context, q string) ([]domain.StickerSet, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []domain.StickerSet{}, nil
	}
	return i.repo.SearchSets(ctx, q, setSearchLim)
}

// Recent — недавно использованные стикеры, новые первыми.
func (i *Interactor) Recent(ctx context.Context, userID int64) ([]domain.Sticker, error) {
	return i.repo.Recent(ctx, userID, recentLimit)
}

// Use отмечает использование стикера (upsert used_at) и держит список в
// пределах recentLimit — как tweb RECENT_STICKERS_COUNT.
func (i *Interactor) Use(ctx context.Context, userID, stickerID int64) error {
	if _, err := i.repo.StickerByID(ctx, stickerID); err != nil {
		return err
	}
	return i.repo.TouchRecent(ctx, userID, stickerID, recentLimit)
}

// Faved — избранные стикеры, новые первыми.
func (i *Interactor) Faved(ctx context.Context, userID int64) ([]domain.Sticker, error) {
	return i.repo.Faved(ctx, userID, favedLimit)
}

// Fave добавляет стикер в избранное (лимит favedLimit — старые вытесняются).
func (i *Interactor) Fave(ctx context.Context, userID, stickerID int64) error {
	if _, err := i.repo.StickerByID(ctx, stickerID); err != nil {
		return err
	}
	return i.repo.Fave(ctx, userID, stickerID, favedLimit)
}

// Unfave убирает стикер из избранного (идемпотентно).
func (i *Interactor) Unfave(ctx context.Context, userID, stickerID int64) error {
	return i.repo.Unfave(ctx, userID, stickerID)
}

// SearchByEmoji — стикеры с данным эмодзи из установленных наборов
// (подсказки стикеров при вводе эмодзи).
func (i *Interactor) SearchByEmoji(ctx context.Context, userID int64, emoji string) ([]domain.Sticker, error) {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" || len(emoji) > maxEmojiBytes {
		return nil, domain.ErrInvalid
	}
	return i.repo.SearchByEmoji(ctx, userID, emoji, emojiSearchLim)
}

// CreateSet создаёт набор. slug: [a-z0-9_]{3,64}; kind: sticker|emoji (пусто →
// sticker); title непустой и не длиннее maxTitleRunes.
func (i *Interactor) CreateSet(ctx context.Context, ownerID int64, slug, title, kind string) (domain.StickerSet, error) {
	if !slugRe.MatchString(slug) {
		return domain.StickerSet{}, domain.ErrInvalid
	}
	if kind == "" {
		kind = "sticker"
	}
	if kind != "sticker" && kind != "emoji" {
		return domain.StickerSet{}, domain.ErrInvalid
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > maxTitleRunes {
		return domain.StickerSet{}, domain.ErrInvalid
	}
	return i.repo.CreateSet(ctx, domain.StickerSet{Slug: slug, Title: title, Kind: kind, CreatedBy: ownerID})
}

// AddSticker пополняет набор: только владелец, media должно существовать.
func (i *Interactor) AddSticker(ctx context.Context, ownerID, setID, mediaID int64, emoji string) (domain.Sticker, error) {
	if len(emoji) > maxEmojiBytes {
		return domain.Sticker{}, domain.ErrInvalid
	}
	set, err := i.repo.SetByID(ctx, setID)
	if err != nil {
		return domain.Sticker{}, err
	}
	if set.CreatedBy != ownerID {
		return domain.Sticker{}, domain.ErrForbidden
	}
	ok, err := i.repo.MediaExists(ctx, mediaID)
	if err != nil {
		return domain.Sticker{}, err
	}
	if !ok {
		return domain.Sticker{}, domain.ErrNotFound
	}
	return i.repo.AddSticker(ctx, domain.Sticker{SetID: setID, MediaID: mediaID, Emoji: emoji})
}

// SavedGifs — сохранённые GIF пользователя, новые первыми.
func (i *Interactor) SavedGifs(ctx context.Context, userID int64) ([]domain.SavedGif, error) {
	return i.repo.SavedGifs(ctx, userID)
}

// SaveGif сохраняет GIF (upsert; хранится не больше savedGifsLimit — старые
// по saved_at вытесняются). media должно существовать.
func (i *Interactor) SaveGif(ctx context.Context, userID, mediaID int64) error {
	ok, err := i.repo.MediaExists(ctx, mediaID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	return i.repo.SaveGif(ctx, userID, mediaID, savedGifsLimit)
}

// DeleteGif удаляет сохранённый GIF (идемпотентно).
func (i *Interactor) DeleteGif(ctx context.Context, userID, mediaID int64) error {
	return i.repo.DeleteGif(ctx, userID, mediaID)
}

// CanUseStickerMedia — можно ли слать/читать media как стикер: наборы
// публичны, так что достаточно принадлежности media любому стикеру.
func (i *Interactor) CanUseStickerMedia(ctx context.Context, _ int64, mediaID int64) (bool, error) {
	return i.repo.IsStickerMedia(ctx, mediaID)
}

// SearchGifs — поиск во внешнем провайдере (пустой q — трендовые). Без
// провайдера — пустая страница, не ошибка (мягкая деградация).
func (i *Interactor) SearchGifs(ctx context.Context, q, pos string) (GifPage, error) {
	if i.gifs == nil {
		return GifPage{Gifs: []Gif{}}, nil
	}
	return i.gifs.SearchGifs(ctx, strings.TrimSpace(q), pos, gifSearchLim)
}
