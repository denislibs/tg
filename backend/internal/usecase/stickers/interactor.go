package stickers

import (
	"context"
	"errors"
	"log"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

// Лимиты хранения — в domain/limits.go (отдаются клиенту конфигом приложения).
const (
	emojiSearchLim = 16
	setSearchLim   = 20
	// featuredLim — потолок выдачи трендов, а не витрина «топ-N»: экран поиска
	// показывает весь каталог (tweb getFeaturedStickers лимита не знает вовсе,
	// содержимое наборов догружается лениво). Значение с запасом над полным
	// каталогом Telegram (~992 набора: 231 трендовых + архив + emoji), но
	// ограничивает ответ, потому что POST /sticker-sets доступен любому
	// пользователю и без потолка чужие наборы раздували бы выдачу всем.
	featuredLim   = 2000
	gifSearchLim  = 30
	maxTitleRunes = 64
	maxEmojiBytes = 32
	// coverLim — превью на набор в covered sets (Featured/SearchSets): tweb
	// показывает min(5, count) стикеров, пока набор не открыт целиком.
	coverLim = 5
)

// slugRe — допустимый slug набора (как короткое имя аддона: t.me/addstickers/<slug>).
var slugRe = regexp.MustCompile(`^[a-z0-9_]{3,64}$`)

// Interactor — бизнес-логика стикеров/GIF поверх портов Repo и GifSearcher.
type Interactor struct {
	repo   Repo
	gifs   GifSearcher
	media  MediaReader // обязателен: проверки «файл свой» и «это гиф»
	access MediaAccess // обязателен для SaveGif: файл виден пользователю
	emit   *ownsync.Emitter
}

// errMediaReaderUnwired — забытая проводка MediaReader/MediaAccess в
// app/server.go: не domain-ошибка, чтобы ручка ответила 500 и записала в лог,
// а не тихим 404.
var errMediaReaderUnwired = errors.New("media reader не подключён")

func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

// SetEmitter подключает журнал своих устройств; без него мутация проходит, но
// второе устройство о ней не узнаёт.
func (i *Interactor) SetEmitter(e *ownsync.Emitter) { i.emit = e }

// SetMediaReader подключает чтение строк media (владелец, mime, Animated).
func (i *Interactor) SetMediaReader(m MediaReader) { i.media = m }

// SetMediaAccess подключает проверку «пользователь видит файл» для SaveGif.
func (i *Interactor) SetMediaAccess(a MediaAccess) { i.access = a }

// SetGifSearch подключает внешний поиск GIF (optional; без него — пустая выдача).
func (i *Interactor) SetGifSearch(g GifSearcher) { i.gifs = g }

// MySets — установленные наборы пользователя (по position установки).
func (i *Interactor) MySets(ctx context.Context, userID int64) ([]domain.StickerSetRecord, error) {
	return i.repo.InstalledSets(ctx, userID)
}

// SetBySlug — набор + его стикеры по slug; срок установки — userID.
func (i *Interactor) SetBySlug(ctx context.Context, userID int64, slug string) (domain.StickerSetRecord, []domain.Sticker, error) {
	set, err := i.repo.SetBySlug(ctx, userID, slug)
	if err != nil {
		return domain.StickerSetRecord{}, nil, err
	}
	sts, err := i.repo.Stickers(ctx, set.ID)
	return set, sts, err
}

// SetByID — набор + его стикеры по id; срок установки — userID.
func (i *Interactor) SetByID(ctx context.Context, userID, id int64) (domain.StickerSetRecord, []domain.Sticker, error) {
	set, err := i.repo.SetByID(ctx, userID, id)
	if err != nil {
		return domain.StickerSetRecord{}, nil, err
	}
	sts, err := i.repo.Stickers(ctx, set.ID)
	return set, sts, err
}

// SetWire — messages.stickerSet из записи набора и его стикеров: один сборщик
// на ответ GET набора и на тело updateNewStickerSet.
func SetWire(set domain.StickerSetRecord, sts []domain.Sticker) domain.MessagesStickerSet {
	return domain.NewMessagesStickerSet(
		domain.StickerSetWire(set), domain.StickerPacks(sts), domain.StickerDocuments(sts))
}

// StickerSetWire — messages.stickerSet набора по id глазами userID (срок
// установки — его).
func (i *Interactor) StickerSetWire(ctx context.Context, userID, id int64) (domain.MessagesStickerSet, error) {
	set, sts, err := i.SetByID(ctx, userID, id)
	if err != nil {
		return domain.MessagesStickerSet{}, err
	}
	return SetWire(set, sts), nil
}

// Install добавляет набор пользователю (идемпотентно). Нет набора → ErrNotFound.
// Новая установка уходит строкой stickers_new_set на устройства владельца
// (tweb appStickersManager.ts:80-84); повтор по уже установленному набору
// ничего не меняет — строки нет.
func (i *Interactor) Install(ctx context.Context, userID, setID int64) error {
	cur, err := i.repo.SetByID(ctx, userID, setID)
	if err != nil {
		return err
	}
	if err := i.repo.Install(ctx, userID, setID); err != nil {
		return err
	}
	if !cur.InstalledAt.IsZero() {
		return nil
	}
	// Снимок перечитывается под замком журнала: набор с документами и сроком
	// установки — состояние, а не сигнал.
	journalErr(userID, "stickers_new_set", i.emit.EmitSnapshot(ctx, userID, "stickers_new_set",
		func(ctx context.Context) (map[string]any, error) {
			w, err := i.StickerSetWire(ctx, userID, setID)
			if err != nil {
				return nil, err
			}
			return map[string]any{"_": domain.UpdateNewStickerSetTag, "stickerset": w}, nil
		}))
	return nil
}

// journalErr логирует сбой записи журнала: мутация уже закоммичена, ответ клиенту
// остаётся успешным, второе устройство догонит при следующем getDifference.
func journalErr(userID int64, typ string, err error) {
	if err != nil {
		log.Printf("ownsync: %s user=%d: %v", typ, userID, err)
	}
}

// signal — строка-сигнал «перечитай» (updateRecentStickers и т. п.): параметров
// у конструктора нет, клиент сам перечитывает список.
func (i *Interactor) signal(ctx context.Context, userID int64, typ, tag string) {
	journalErr(userID, typ, i.emit.Emit(ctx, []int64{userID}, typ, map[string]any{"_": tag}))
}

// Uninstall убирает набор у пользователя (идемпотентно).
func (i *Interactor) Uninstall(ctx context.Context, userID, setID int64) error {
	return i.repo.Uninstall(ctx, userID, setID)
}

// SearchSets ищет наборы по title/slug (ilike) и отдаёт вместе с ними превью
// (covered sets): без превью строка поиска пуста до похода за полным набором,
// а по 338 наборам разом это N+1 запросов — CoverStickers берёт все одним.
// Пустой запрос — пустая выдача. Срок установки у наборов — userID.
func (i *Interactor) SearchSets(ctx context.Context, userID int64, q string) ([]domain.StickerSetRecord, map[int64][]domain.Sticker, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []domain.StickerSetRecord{}, map[int64][]domain.Sticker{}, nil
	}
	sets, err := i.repo.SearchSets(ctx, userID, q, setSearchLim)
	if err != nil {
		return nil, nil, err
	}
	covers, err := i.covers(ctx, sets)
	return sets, covers, err
}

// Featured — трендовые наборы для экрана поиска стикеров при пустом запросе
// (аналог tweb messages.getFeaturedStickers): наборы публичны, порядок задаёт
// rank из выгрузки. Вместе с наборами отдаёт превью (covered sets) — тем же
// приёмом, что SearchSets. Срок установки у наборов — userID.
func (i *Interactor) Featured(ctx context.Context, userID int64) ([]domain.StickerSetRecord, map[int64][]domain.Sticker, error) {
	sets, err := i.repo.FeaturedSets(ctx, userID, featuredLim)
	if err != nil {
		return nil, nil, err
	}
	covers, err := i.covers(ctx, sets)
	return sets, covers, err
}

// covers — превью наборов одним запросом (covered sets): setIDs собираются из
// уже полученной выдачи, а не гоняются циклом по одному набору за раз.
func (i *Interactor) covers(ctx context.Context, sets []domain.StickerSetRecord) (map[int64][]domain.Sticker, error) {
	if len(sets) == 0 {
		return map[int64][]domain.Sticker{}, nil
	}
	setIDs := make([]int64, len(sets))
	for k, s := range sets {
		setIDs[k] = s.ID
	}
	return i.repo.CoverStickers(ctx, setIDs, coverLim)
}

// Recent — недавно использованные стикеры, новые первыми.
func (i *Interactor) Recent(ctx context.Context, userID int64) ([]domain.RecentSticker, error) {
	return i.repo.Recent(ctx, userID, domain.RecentStickersLimit)
}

// ClearRecent — очистить список недавних (tweb clearRecentStickers).
func (i *Interactor) ClearRecent(ctx context.Context, userID int64) error {
	if err := i.repo.ClearRecent(ctx, userID); err != nil {
		return err
	}
	i.signal(ctx, userID, "stickers_recent", domain.UpdateRecentStickersTag)
	return nil
}

// Use отмечает использование стикера (upsert used_at) и держит список в
// пределах domain.RecentStickersLimit — как tweb RECENT_STICKERS_COUNT.
//
// Адресует ФАЙЛ (document.id схемы), а не строку набора: у оригинала
// messages.saveRecentSticker принимает InputDocument. Побочно это снимает
// дубль — тот же файл из двух наборов давал две записи (Р2).
//
// Строка журнала — только если порядок недавних изменился: Use зовётся на
// каждую отправку стикера, а повтор того же стикера, что уже первый, ничего
// не меняет.
func (i *Interactor) Use(ctx context.Context, userID, mediaID int64) error {
	if _, err := i.repo.StickerByMediaID(ctx, mediaID); err != nil {
		return err
	}
	changed, err := i.repo.TouchRecent(ctx, userID, mediaID, domain.RecentStickersLimit)
	if err != nil {
		return err
	}
	if changed {
		i.signal(ctx, userID, "stickers_recent", domain.UpdateRecentStickersTag)
	}
	return nil
}

// Faved — избранные стикеры, новые первыми.
func (i *Interactor) Faved(ctx context.Context, userID int64) ([]domain.Sticker, error) {
	return i.repo.Faved(ctx, userID, domain.FavedStickersLimit)
}

// Fave добавляет стикер в избранное (лимит domain.FavedStickersLimit — старые вытесняются).
// Адресует ФАЙЛ — как messages.faveSticker(InputDocument) у оригинала.
func (i *Interactor) Fave(ctx context.Context, userID, mediaID int64) error {
	if _, err := i.repo.StickerByMediaID(ctx, mediaID); err != nil {
		return err
	}
	if err := i.repo.Fave(ctx, userID, mediaID, domain.FavedStickersLimit); err != nil {
		return err
	}
	i.signal(ctx, userID, "stickers_faved", domain.UpdateFavedStickersTag)
	return nil
}

// Unfave убирает стикер из избранного (идемпотентно).
func (i *Interactor) Unfave(ctx context.Context, userID, mediaID int64) error {
	if err := i.repo.Unfave(ctx, userID, mediaID); err != nil {
		return err
	}
	i.signal(ctx, userID, "stickers_faved", domain.UpdateFavedStickersTag)
	return nil
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
func (i *Interactor) CreateSet(ctx context.Context, ownerID int64, slug, title, kind string) (domain.StickerSetRecord, error) {
	if !slugRe.MatchString(slug) {
		return domain.StickerSetRecord{}, domain.ErrInvalid
	}
	if kind == "" {
		kind = "sticker"
	}
	if kind != "sticker" && kind != "emoji" {
		return domain.StickerSetRecord{}, domain.ErrInvalid
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > maxTitleRunes {
		return domain.StickerSetRecord{}, domain.ErrInvalid
	}
	return i.repo.CreateSet(ctx, domain.StickerSetRecord{Slug: slug, Title: title, Kind: kind, CreatedBy: ownerID})
}

// stickerMimes — форматы файла стикера (tweb appDocsManager.ts:207-218, :271:
// webp, webm, tgs) плюс те, что кладёт сид (png, lottie-json). Проверяется mime
// из строки media; Content-Type объекта в хранилище при многочастной загрузке
// может разойтись со строкой (FinalizeUpload) — это открытый пункт, см. PR.
var stickerMimes = map[string]bool{
	"image/webp": true, "image/png": true, "video/webm": true,
	"application/x-tgsticker": true, "application/json": true,
}

// requireSetCreatorMedia — файл стикера загружен создателем набора и имеет
// формат стикера. Иначе «свой набор» делал бы любой чужой media_id (или файл
// любого mime) публичным: IsStickerMedia отдаёт файл стикера всем. Нет файла,
// чужой файл и не-стикер — один ErrNotFound.
func (i *Interactor) requireSetCreatorMedia(ctx context.Context, creatorID, mediaID int64) error {
	if i.media == nil {
		return errMediaReaderUnwired
	}
	m, err := i.media.GetByID(ctx, mediaID)
	if err != nil {
		return err
	}
	if m.OwnerID != creatorID || !stickerMimes[m.Mime] {
		return domain.ErrNotFound
	}
	return nil
}

// AddSticker пополняет набор: только владелец, файл — его загрузка.
func (i *Interactor) AddSticker(ctx context.Context, ownerID, setID, mediaID int64, emoji string) (domain.Sticker, error) {
	if len(emoji) > maxEmojiBytes {
		return domain.Sticker{}, domain.ErrInvalid
	}
	set, err := i.repo.SetByID(ctx, ownerID, setID)
	if err != nil {
		return domain.Sticker{}, err
	}
	if set.CreatedBy != ownerID {
		return domain.Sticker{}, domain.ErrForbidden
	}
	if err := i.requireSetCreatorMedia(ctx, set.CreatedBy, mediaID); err != nil {
		return domain.Sticker{}, err
	}
	return i.repo.AddSticker(ctx, domain.Sticker{SetID: setID, MediaID: mediaID, Emoji: emoji})
}

// AddStickerAt пополняет набор на явную позицию — те же проверки, что у
// AddSticker (владелец набора, файл — его загрузка), но используется только сидом
// (cmd/seed-stickers): публичному API взять позицию неоткуда, там позицию
// назначает хранилище через AddSticker.
func (i *Interactor) AddStickerAt(ctx context.Context, ownerID, setID, mediaID int64, emoji string, position int, pathThumb []byte) (domain.Sticker, error) {
	if len(emoji) > maxEmojiBytes {
		return domain.Sticker{}, domain.ErrInvalid
	}
	set, err := i.repo.SetByID(ctx, ownerID, setID)
	if err != nil {
		return domain.Sticker{}, err
	}
	if set.CreatedBy != ownerID {
		return domain.Sticker{}, domain.ErrForbidden
	}
	if err := i.requireSetCreatorMedia(ctx, set.CreatedBy, mediaID); err != nil {
		return domain.Sticker{}, err
	}
	return i.repo.AddStickerAt(ctx, setID, mediaID, emoji, position, pathThumb)
}

// SavedGifs — сохранённые GIF пользователя, новые первыми.
func (i *Interactor) SavedGifs(ctx context.Context, userID int64) ([]domain.SavedGif, error) {
	return i.repo.SavedGifs(ctx, userID)
}

// SaveGif — messages.saveGif: документ адресуется доступом (InputDocument с
// access_hash, tweb appGifsManager.ts:109-120), поэтому сохраняется только то,
// что пользователь видит (CanAccessMedia), и только гиф (documentAttributeAnimated).
// Хранится не больше domain.SavedGifsLimit — старые по saved_at вытесняются.
func (i *Interactor) SaveGif(ctx context.Context, userID, mediaID int64) error {
	if i.access == nil || i.media == nil {
		return errMediaReaderUnwired
	}
	// Дешёвое чтение по PK — до дорогой проверки доступа: отказ «нет файла /
	// не гиф» и отказ «не виден» отвечают одинаково (404).
	m, err := i.media.GetByID(ctx, mediaID)
	if err != nil {
		return err
	}
	// Вид: documentAttributeAnimated и mime gif/mp4 (tweb appDocsManager.ts:
	// 230-235) либо image/gif. Свой video/mp4, у которого фоновая обработка
	// ещё не отдала постер (ThumbKey пуст, Animated ещё false), — тоже: клиент
	// Tenor-гифа зовёт saveGif сразу после sendFile (input.ts:2843-2866). Своё
	// обработанное видео без Animated гифом не станет.
	animated := m.Animated && (m.Mime == "image/gif" || m.Mime == "video/mp4")
	ownFresh := m.OwnerID == userID && m.Mime == "video/mp4" && m.ThumbKey == ""
	if !animated && m.Mime != "image/gif" && !ownFresh {
		return domain.ErrNotFound
	}
	ok, err := i.access.CanAccessMedia(ctx, userID, mediaID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	if err := i.repo.SaveGif(ctx, userID, mediaID, domain.SavedGifsLimit); err != nil {
		return err
	}
	i.signal(ctx, userID, "saved_gifs", domain.UpdateSavedGifsTag)
	return nil
}

// DeleteGif удаляет сохранённый GIF (идемпотентно).
func (i *Interactor) DeleteGif(ctx context.Context, userID, mediaID int64) error {
	if err := i.repo.DeleteGif(ctx, userID, mediaID); err != nil {
		return err
	}
	i.signal(ctx, userID, "saved_gifs", domain.UpdateSavedGifsTag)
	return nil
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

// SetRank — позиция набора в трендах (см. domain.StickerSetRecord.Rank).
func (i *Interactor) SetRank(ctx context.Context, setID int64, rank int) error {
	return i.repo.SetRank(ctx, setID, rank)
}

// SetCover — обложка набора (иконка вкладки панели).
func (i *Interactor) SetCover(ctx context.Context, setID, mediaID int64) error {
	return i.repo.SetCover(ctx, setID, mediaID)
}

// StickerPositions — занятые позиции набора (см. Repo.StickerPositions).
func (i *Interactor) StickerPositions(ctx context.Context, setID int64) (map[int]struct{}, error) {
	return i.repo.StickerPositions(ctx, setID)
}

// BackfillPathThumbs — см. Repo.BackfillPathThumbs.
func (i *Interactor) BackfillPathThumbs(ctx context.Context, setID int64, thumbs map[int][]byte) error {
	return i.repo.BackfillPathThumbs(ctx, setID, thumbs)
}
