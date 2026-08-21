package domain

// Наборы стикеров в модели схемы TL. Разбор и решения Р1–Р9 —
// docs/readiness/tl-stickers-analysis.md.
//
// Главное этого файла: САМ СТИКЕР здесь не объявлен, и это не пропуск. В схеме
// стикера как типа нет вовсе — он `Document` с `documentAttributeSticker` в
// `attributes` (mtmedia.go). Поэтому векторы `documents`/`stickers`/`gifs`
// контейнеров ниже несут ту же структуру, что вложение сообщения: одна модель,
// одна сверка со схемой, один рендерер у клиента.
//
// Не производятся (предмета нет; объявлены, потому что кодек фазы 2 обязан их
// понимать):
//
//   - `hash` у всех контейнеров и парные `*NotModified` — механизм «не
//     менялось» у MTProto. Предмет есть, но у REST его место — заголовки
//     (ETag/304), а не тело. Пересмотреть на фазе 2, когда провод станет
//     бинарным и заголовков у кадра не будет (Р7);
//   - `access_hash` у набора и у `inputStickerSetID` — токен доступа
//     транспорта MTProto; набор у нас адресуется числовым id;
//   - `thumb_dc_id`/`thumb_version` — номер датацентра и версия превью того же
//     транспорта;
//   - `keywords` — поиск стикера по СЛОВУ (а не по эмодзи). Источника нет: мы
//     таких слов не храним, вектор едет пустым (Р6);
//   - `masks`/`official`/`archived`/`creator`/`text_color`/
//     `channel_emoji_status` — свойства наборов Telegram, которых у нас нет.

// Теги конструкторов этого файла.
const (
	StickerSetTag               = "stickerSet"
	StickerPackTag              = "stickerPack"
	StickerKeywordTag           = "stickerKeyword"
	StickerSetCoveredTag        = "stickerSetCovered"
	StickerSetFullCoveredTag    = "stickerSetFullCovered"
	InputStickerSetEmptyTag     = "inputStickerSetEmpty"
	InputStickerSetIDTag        = "inputStickerSetID"
	MessagesAllStickersTag      = "messages.allStickers"
	MessagesStickerSetTag       = "messages.stickerSet"
	MessagesRecentStickersTag   = "messages.recentStickers"
	MessagesFavedStickersTag    = "messages.favedStickers"
	MessagesFeaturedStickersTag = "messages.featuredStickers"
	MessagesStickersTag         = "messages.stickers"
	MessagesSavedGifsTag        = "messages.savedGifs"
)

// InputStickerSet — объединение схемы (адрес набора). Производим два
// конструктора из четырнадцати: пустой и по числовому id.
//
// Остальные двенадцать (`inputStickerSetShortName`, `inputStickerSetDice`,
// `inputStickerSetAnimatedEmoji`, `inputStickerSetPremiumGifts`, …) адресуют
// ВСТРОЕННЫЕ наборы Telegram, которых у нас нет как сущности.
type InputStickerSet interface{ isInputStickerSet() }

// inputStickerSetEmpty#ffb62b95 = InputStickerSet;
//
// «Набора нет». Им едет `documentAttributeSticker.stickerset` у документа,
// который стикером СТАЛ (сообщение типа sticker), но в наборе не числится, —
// например у стикера удалённого набора.
type InputStickerSetEmpty struct {
	Underscore string `json:"_"`
}

func (InputStickerSetEmpty) isInputStickerSet() {}

// NewInputStickerSetEmpty — конструктор «набора нет».
func NewInputStickerSetEmpty() InputStickerSetEmpty {
	return InputStickerSetEmpty{Underscore: InputStickerSetEmptyTag}
}

// inputStickerSetID#9de7a269 id:long access_hash:long = InputStickerSet;
//
// access_hash — токен доступа транспорта MTProto, у нас предмета не имеет;
// на проводе фазы 2 пойдёт нулём (общее правило: обязательный параметр без
// предмета — заглушка, и её надо назвать).
type InputStickerSetID struct {
	Underscore string `json:"_"`
	ID         int64  `json:"id"`
}

func (InputStickerSetID) isInputStickerSet() {}

// NewInputStickerSetID — адрес набора по числовому id.
func NewInputStickerSetID(id int64) InputStickerSetID {
	return InputStickerSetID{Underscore: InputStickerSetIDTag, ID: id}
}

// stickerSetAddr — адрес набора для documentAttributeSticker: id или «набора
// нет». Развилка стоит ЗДЕСЬ, а не у каждого вызывающего, ровно чтобы ноль не
// уехал наружу как настоящий адрес.
func stickerSetAddr(setID int64) InputStickerSet {
	if setID == 0 {
		return NewInputStickerSetEmpty()
	}
	return NewInputStickerSetID(setID)
}

// stickerSet#2dd14edc flags:# archived:flags.1?true official:flags.2?true
// masks:flags.3?true emojis:flags.7?true text_color:flags.9?true
// channel_emoji_status:flags.10?true creator:flags.11?true
// installed_date:flags.0?int id:long access_hash:long title:string
// short_name:string thumbs:flags.4?Vector<PhotoSize> thumb_dc_id:flags.4?int
// thumb_version:flags.4?int thumb_document_id:flags.8?long count:int hash:int
// = StickerSet;
//
// Три места, где схема выражает то, что у нас было выражено иначе:
//
//   - `pFlags.emojis` вместо строки `kind:'sticker'|'emoji'` — шестой экземпляр
//     «вид сущности подделан строкой» (Р4);
//   - `installed_date` вместо «набор попал в ответ ручки моих наборов». Это
//     параметр САМОГО набора, поэтому один и тот же набор в списке моих и в
//     трендах перестаёт выглядеть по-разному, а порядок в панели считает
//     клиент — по времени установки (Р5);
//   - `thumb_document_id` вместо `cover_media_id`. Схема при этом различает два
//     случая, которых мы не различали: обложка-КАРТИНКА (`thumbs` — отдельный
//     файл превью) и обложка-ДОКУМЕНТ (один из стикеров набора назначен
//     обложкой). Наш `cover_media_id` — второе (Р9).
//
// `Rank` (позиция в трендах) на провод не выходит вовсе: порядок задаёт
// позиция в векторе `messages.featuredStickers.sets`, и это ЕДИНСТВЕННОЕ его
// выражение — иначе появится второй источник, как было у `is_end` диалогов.
type StickerSet struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// InstalledDate — время установки набора (unix-секунды). 0 — не установлен;
	// ключ при этом не появляется вовсе (flags-параметр).
	InstalledDate int64  `json:"installed_date,omitempty"`
	ID            int64  `json:"id"`
	Title         string `json:"title"`
	ShortName     string `json:"short_name"`
	// Thumbs — ступени превью обложки. Пусто, когда обложка задана документом
	// (ThumbDocumentID) либо её нет вовсе.
	Thumbs []PhotoSize `json:"thumbs,omitempty"`
	// ThumbDocumentID — стикер набора, назначенный обложкой. 0 — обложки нет,
	// клиент рисует первый стикер (правило клиента, как в tweb).
	ThumbDocumentID int64 `json:"thumb_document_id,omitempty"`
	Count           int   `json:"count"`
}

// stickerPack#12b299d4 emoticon:string documents:Vector<long> = StickerPack;
//
// Обратный индекс «эмодзи → документы». У нас эмодзи висело НА КАЖДОМ стикере
// ровно одно, а подсказка по эмодзи была отдельным запросом к серверу; в
// оригинале индекс приезжает вместе с набором и подсказку клиент считает сам
// (Р6). Это не только про число запросов: `packs` — единственное место, где на
// один документ может приходиться НЕСКОЛЬКО эмодзи.
type StickerPack struct {
	Underscore string  `json:"_"`
	Emoticon   string  `json:"emoticon"`
	Documents  []int64 `json:"documents"`
}

// NewStickerPack — одна строка обратного индекса.
func NewStickerPack(emoticon string, documents []int64) StickerPack {
	return StickerPack{Underscore: StickerPackTag, Emoticon: emoticon, Documents: documents}
}

// stickerKeyword#fcfeb29c document_id:long keyword:Vector<string> =
// StickerKeyword;
//
// Объявлен, но не производится: слов для поиска мы не храним (Р6). Нужен
// кодеку фазы 2 и потребителю, который обязан уметь принять непустой вектор.
type StickerKeyword struct {
	Underscore string   `json:"_"`
	DocumentID int64    `json:"document_id"`
	Keyword    []string `json:"keyword"`
}

// StickerSetCovered — объединение схемы: набор + чем его показать в трендах.
// Производим два конструктора из четырёх.
type StickerSetCovered interface{ isStickerSetCovered() }

// stickerSetCovered#6410a5d2 set:StickerSet cover:Document = StickerSetCovered;
//
// Набор с ОДНОЙ обложкой — тем, что рисует карточку в трендах.
type StickerSetCoveredOne struct {
	Underscore string     `json:"_"`
	Set        StickerSet `json:"set"`
	Cover      *Document  `json:"cover"`
}

func (StickerSetCoveredOne) isStickerSetCovered() {}

// stickerSetFullCovered#40d13c0e set:StickerSet packs:Vector<StickerPack>
// keywords:Vector<StickerKeyword> documents:Vector<Document> =
// StickerSetCovered;
//
// Набор целиком — им отвечаем, когда содержимое уже собрано и второй запрос за
// ним не нужен.
type StickerSetFullCovered struct {
	Underscore string           `json:"_"`
	Set        StickerSet       `json:"set"`
	Packs      []StickerPack    `json:"packs"`
	Keywords   []StickerKeyword `json:"keywords"`
	Documents  []*Document      `json:"documents"`
}

func (StickerSetFullCovered) isStickerSetCovered() {}

// messages.allStickers#cdbbcebb hash:long sets:Vector<StickerSet> =
// messages.AllStickers;
//
// Мои наборы. Парный messages.allStickersNotModified#e86602c3 не производится
// (Р7).
type MessagesAllStickers struct {
	Underscore string       `json:"_"`
	Sets       []StickerSet `json:"sets"`
}

// NewMessagesAllStickers — контейнер моих наборов.
func NewMessagesAllStickers(sets []StickerSet) MessagesAllStickers {
	if sets == nil {
		sets = []StickerSet{}
	}
	return MessagesAllStickers{Underscore: MessagesAllStickersTag, Sets: sets}
}

// messages.stickerSet#6e153f16 set:StickerSet packs:Vector<StickerPack>
// keywords:Vector<StickerKeyword> documents:Vector<Document> =
// messages.StickerSet;
//
// Набор со СТИКЕРАМИ. Порядок внутри набора задаёт позиция в `documents` — наш
// `Position` на провод не выходит (Р8).
type MessagesStickerSet struct {
	Underscore string           `json:"_"`
	Set        StickerSet       `json:"set"`
	Packs      []StickerPack    `json:"packs"`
	Keywords   []StickerKeyword `json:"keywords"`
	Documents  []*Document      `json:"documents"`
}

// NewMessagesStickerSet — контейнер набора со стикерами.
func NewMessagesStickerSet(set StickerSet, packs []StickerPack, docs []*Document) MessagesStickerSet {
	return MessagesStickerSet{
		Underscore: MessagesStickerSetTag,
		Set:        set,
		Packs:      emptyIfNilPacks(packs),
		Keywords:   []StickerKeyword{},
		Documents:  emptyIfNilDocs(docs),
	}
}

// messages.recentStickers#88d37c56 hash:long packs:Vector<StickerPack>
// stickers:Vector<Document> dates:Vector<int> = messages.RecentStickers;
//
// Недавние. `dates` — когда стикер был использован; у нас порядок был неявным
// (сортировка на сервере), теперь он выражен явно и параллельно вектору.
type MessagesRecentStickers struct {
	Underscore string        `json:"_"`
	Packs      []StickerPack `json:"packs"`
	Stickers   []*Document   `json:"stickers"`
	Dates      []int64       `json:"dates"`
}

// NewMessagesRecentStickers — контейнер недавних. dates обязан быть той же
// длины, что stickers: это параллельные векторы одной записи.
func NewMessagesRecentStickers(docs []*Document, dates []int64) MessagesRecentStickers {
	if dates == nil {
		dates = []int64{}
	}
	return MessagesRecentStickers{
		Underscore: MessagesRecentStickersTag,
		Packs:      []StickerPack{},
		Stickers:   emptyIfNilDocs(docs),
		Dates:      dates,
	}
}

// messages.favedStickers#2cb51097 hash:long packs:Vector<StickerPack>
// stickers:Vector<Document> = messages.FavedStickers;
type MessagesFavedStickers struct {
	Underscore string        `json:"_"`
	Packs      []StickerPack `json:"packs"`
	Stickers   []*Document   `json:"stickers"`
}

// NewMessagesFavedStickers — контейнер избранных.
func NewMessagesFavedStickers(docs []*Document, packs []StickerPack) MessagesFavedStickers {
	return MessagesFavedStickers{
		Underscore: MessagesFavedStickersTag,
		Packs:      emptyIfNilPacks(packs),
		Stickers:   emptyIfNilDocs(docs),
	}
}

// messages.featuredStickers#be382906 flags:# premium:flags.0?true hash:long
// count:int sets:Vector<StickerSetCovered> unread:Vector<long> =
// messages.FeaturedStickers;
//
// Тренды. `unread` — наборы, карточку которых пользователь ещё не открывал;
// источника у нас нет, вектор едет пустым. `premium` предмета не имеет.
type MessagesFeaturedStickers struct {
	Underscore string              `json:"_"`
	Count      int                 `json:"count"`
	Sets       []StickerSetCovered `json:"sets"`
	Unread     []int64             `json:"unread"`
}

// NewMessagesFeaturedStickers — контейнер трендов.
func NewMessagesFeaturedStickers(count int, sets []StickerSetCovered) MessagesFeaturedStickers {
	if sets == nil {
		sets = []StickerSetCovered{}
	}
	return MessagesFeaturedStickers{
		Underscore: MessagesFeaturedStickersTag,
		Count:      count,
		Sets:       sets,
		Unread:     []int64{},
	}
}

// messages.stickers#30a6ec7e hash:long stickers:Vector<Document> =
// messages.Stickers;
//
// Поиск стикеров по эмодзи. Ручка остаётся, хотя `packs` даёт клиенту тот же
// ответ по УСТАНОВЛЕННЫМ наборам: поиск идёт по всем наборам, включая
// неустановленные, содержимого которых у клиента нет.
type MessagesStickers struct {
	Underscore string      `json:"_"`
	Stickers   []*Document `json:"stickers"`
}

// NewMessagesStickers — контейнер найденных стикеров.
func NewMessagesStickers(docs []*Document) MessagesStickers {
	return MessagesStickers{Underscore: MessagesStickersTag, Stickers: emptyIfNilDocs(docs)}
}

// messages.savedGifs#84a02a0d hash:long gifs:Vector<Document> =
// messages.SavedGifs;
//
// Сохранённые GIF — тоже документы, а не своя структура: у нас была
// `SavedGif{media_id, saved_at}`, то есть голая ссылка, из-за которой клиент
// не знал ни размеров, ни mime, пока не скачает файл.
type MessagesSavedGifs struct {
	Underscore string      `json:"_"`
	Gifs       []*Document `json:"gifs"`
}

// NewMessagesSavedGifs — контейнер сохранённых GIF.
func NewMessagesSavedGifs(docs []*Document) MessagesSavedGifs {
	return MessagesSavedGifs{Underscore: MessagesSavedGifsTag, Gifs: emptyIfNilDocs(docs)}
}

// emptyIfNilDocs / emptyIfNilPacks — пустой вектор схемы это вектор нулевой
// длины, а не отсутствие поля: у контейнеров эти параметры ОБЯЗАТЕЛЬНЫЕ.
// Поэтому `omitempty` на них нет, а nil заменяется пустым срезом здесь.
func emptyIfNilDocs(docs []*Document) []*Document {
	if docs == nil {
		return []*Document{}
	}
	return docs
}

func emptyIfNilPacks(packs []StickerPack) []StickerPack {
	if packs == nil {
		return []StickerPack{}
	}
	return packs
}
