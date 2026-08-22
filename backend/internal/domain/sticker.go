package domain

import "time"

// Вид набора в СТРОКЕ таблицы (колонка `kind`). На проводе его нет: вид
// выражается флагом `stickerSet.pFlags.emojis` (Р4 разбора стикеров).
const (
	StickerSetKindSticker = "sticker"
	StickerSetKindEmoji   = "emoji"
)

// StickerSetRecord — СТРОКА таблицы наборов, внутренний тип. Наружу набор
// выходит конструктором схемы `stickerSet` (mtstickerset.go), поэтому имя
// `StickerSet` занято им, а не этой структурой — тот же ход, что у `chats`
// (`ChatRecord` против `chat`).
//
// json-тегов здесь нет и быть не должно: строка таблицы на провод не выходит,
// её переводит `StickerSetWire` (stickerwire.go). Пин — сверка со схемой.
//
// Наборы публичны: контент любого набора может смотреть и слать каждый;
// CreatedBy нужен только для права пополнять набор.
type StickerSetRecord struct {
	ID           int64
	Slug         string
	Title        string
	Kind         string
	StickerCount int
	CreatedBy    int64
	// Rank — позиция набора в трендах Telegram (0 — вне трендов, такие идут
	// последними). Осмыслен только на сервере: на проводе порядок задаёт
	// позиция в векторе `messages.featuredStickers.sets` (Р8).
	Rank int
	// CoverMediaID — обложка набора (иконка вкладки, tweb stickerSetThumb);
	// 0 — обложки нет, клиент рисует первый стикер набора.
	CoverMediaID int64
	// InstalledAt — когда пользователь установил набор
	// (`user_sticker_sets.added_at`). Нулевое время — не установлен либо
	// выборка не про конкретного пользователя (тренды, поиск). На проводе это
	// `stickerSet.installed_date` — параметр САМОГО набора, поэтому один и тот
	// же набор в списке моих и в трендах перестаёт выглядеть по-разному (Р5).
	InstalledAt time.Time
}

// Sticker — один стикер набора: СТРОКА таблицы, внутренний тип. Наружу стикер
// выходит конструктором `document` — своего типа в схеме у него нет вовсе
// (Р1), перевод делает `StickerDocument` (stickerwire.go).
//
// Width/Height/Mime/Size/Thumb — зеркало полей media, снятое джойном: клиенту
// они нужны ДО загрузки самого файла. По ним он вписывает стикер в бокс по
// пропорции (tweb `makeMediaSize(doc.w, doc.h).aspectFitted`), заранее знает,
// чем рисовать (lottie/webp/webm), и показывает нижний слой превью, пока файл
// летит.
type Sticker struct {
	ID       int64
	SetID    int64
	MediaID  int64
	Emoji    string
	Position int
	// Width/Height — 0, если размеры не известны (медиа загружено до появления
	// процессинга, либо ffprobe/lottie-разбор ничего не дали); клиент в этом
	// случае падает на квадратный бокс.
	Width  int
	Height int
	Mime   string
	// Size — размер файла в байтах (`document.size` схемы). 0 — неизвестен.
	Size int64
	// Thumb — stripped-превью из media.blur_preview (крошечный JPEG, см.
	// domain.Media.BlurPreview). nil у lottie (на бэке не растеризуем — первый
	// кадр клиент кэширует сам) и у медиа без сгенерированного превью.
	Thumb []byte
	// PathThumb — векторный контур стикера (Telegram photoPathSize), которым
	// клиент рисует SVG-силуэт мгновенно, пока грузится сам файл (tweb
	// wrappers/sticker.ts:268). В отличие от Thumb лежит не в media, а в самой
	// строке стикера: это метаданные набора, а не отдельный файл. nil, если у
	// Telegram-документа контура не было.
	PathThumb []byte
}

// RecentSticker — стикер ВМЕСТЕ со временем последнего использования.
//
// Отдельный тип, а не поле на `Sticker`: «когда я его использовал» — свойство
// пары «пользователь + файл», а не строки набора, и на всех остальных выборках
// его нет вовсе. На проводе это параллельный вектор `dates` контейнера
// `messages.recentStickers` — параллельный, потому что так в схеме.
type RecentSticker struct {
	Sticker
	UsedAt time.Time
}

// SavedGif — сохранённый пользователем GIF: СТРОКА таблицы вместе с
// метаданными файла, снятыми джойном на media.
//
// Метаданные здесь появились с переходом на конструкторы: на проводе GIF едет
// ДОКУМЕНТОМ (`messages.savedGifs.gifs`), а не голой ссылкой на файл, — прежде
// клиент не знал ни размеров, ни mime, пока не скачает сам файл, и вкладка GIF
// прыгала по мере загрузки.
type SavedGif struct {
	MediaID int64
	SavedAt time.Time
	Width   int
	Height  int
	Mime    string
	Size    int64
	// Blur — stripped-превью (media.blur_preview): нижний слой, пока файл летит.
	Blur []byte
	// Animated — файл проигрывается как гифка (media.animated): у документа это
	// `documentAttributeAnimated`, из которого оригинал выводит doc.type='gif'.
	Animated bool
}
