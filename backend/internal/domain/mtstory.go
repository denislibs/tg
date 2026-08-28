package domain

import "encoding/json"

// Истории в форме оригинала — конструкторы схемы TL. Правила фазы 0 (что такое
// pFlags, куда девать свои поля, почему «выключено» это ОТСУТСТВИЕ ключа) — в
// шапке mtmedia.go. Разбор расхождений и решения Р1–Р12 —
// docs/readiness/tl-stories-analysis.md.
//
// До этого шага история ехала плоской записью `storyJSON` (story_handler.go), в
// которой собрались ВСЕ болезни, вылеченные прошлыми портами поодиночке:
// медиа ссылкой (`media_id` вместо обязательного MessageMedia), вид строкой
// (дважды: `privacy` и `media_areas[].type`), пер-зрительский признак на каждом
// элементе вместо горизонта (`viewed`), карточка автора внутри группы вместо
// вектора `users`, удаление отдельным кадром вместо выбора конструктора.
//
// Здесь объявлена МОДЕЛЬ (шаг A). Витрины и журнал переводит шаг B, клиент —
// шаг C, кадры — шаг D; горизонт прочтения (`peerStories.max_read_id`) требует
// пер-авторской нумерации историй — она сделана миграцией 0126.

// Значения дискриминатора `_` подсистемы историй.
const (
	StoryItemTag        = "storyItem"
	StoryItemDeletedTag = "storyItemDeleted"
	StoryViewsTag       = "storyViews"
	StoryFwdHeaderTag   = "storyFwdHeader"
	StoryViewTag        = "storyView"
	PeerStoriesTag      = "peerStories"

	MediaAreaCoordinatesTag       = "mediaAreaCoordinates"
	MediaAreaGeoPointTag          = "mediaAreaGeoPoint"
	MediaAreaVenueTag             = "mediaAreaVenue"
	MediaAreaSuggestedReactionTag = "mediaAreaSuggestedReaction"
	MediaAreaURLTag               = "mediaAreaUrl"

	PrivacyValueAllowAllTag          = "privacyValueAllowAll"
	PrivacyValueAllowContactsTag     = "privacyValueAllowContacts"
	PrivacyValueAllowCloseFriendsTag = "privacyValueAllowCloseFriends"
	PrivacyValueAllowUsersTag        = "privacyValueAllowUsers"

	StoriesStealthModeTag    = "storiesStealthMode"
	StoriesAllStoriesTag     = "stories.allStories"
	StoriesStoriesTag        = "stories.stories"
	StoriesStoryViewsListTag = "stories.storyViewsList"
)

// ── StoryItem: объединение ──────────────────────────────────────────────────

// StoryItem — объединение схемы: `storyItem` (история) либо `storyItemDeleted`
// (её УДАЛИЛИ). Второй конструктор здесь несёт ту же нагрузку, что
// `draftMessageEmpty` у черновика и `messageService` у сообщения: «истории
// больше нет» это ВЫБОР конструктора, а не отдельный кадр рядом.
//
// `storyItemSkipped` не производится: состояния «знаю про историю, но тела не
// даю» у нас нет — лента всегда отдаёт тело целиком.
type StoryItem interface {
	isStoryItem()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// storyItem#16a4b93c flags:# pinned:flags.5?true public:flags.7?true
// close_friends:flags.8?true min:flags.9?true noforwards:flags.10?true
// edited:flags.11?true contacts:flags.12?true selected_contacts:flags.13?true
// out:flags.16?true id:int date:int from_id:flags.18?Peer
// fwd_from:flags.17?StoryFwdHeader expire_date:int caption:flags.0?string
// entities:flags.1?Vector<MessageEntity> media:MessageMedia
// media_areas:flags.14?Vector<MediaArea> privacy:flags.2?Vector<PrivacyRuleRecord>
// views:flags.3?StoryViews sent_reaction:flags.15?Reaction
// albums:flags.19?Vector<int> music:flags.20?Document = StoryItem;
//
// Три параметра стоят объяснения:
//
//   - `media` ОБЯЗАТЕЛЕН и это ступень, а не ссылка. Наш `media_id: int64` —
//     единственное, что история сообщала о содержимом, поэтому вьювер не знал
//     ни размеров, ни типа, ни превью. Ступень уже построена портом медиа, её
//     осталось подключить (Р1);
//   - `privacy` — вектор ПРАВИЛ, а не строка. Наши четыре значения
//     everyone/contacts/close/selected — это флаги public/contacts/
//     close_friends/selected_contacts, а `allow_user_ids` —
//     privacyValueAllowUsers внутри того же вектора (Р4). Аудиторию по-прежнему
//     видит только автор: у оригинала `privacy` едет тому, кто историю
//     опубликовал, — правило не меняется, меняется форма;
//   - `sent_reaction` — единственная ПЕР-ЗРИТЕЛЬСКАЯ часть реакций. Счётчики и
//     разбивка лежат внутри `views`, и это не перестановка: тело истории одно
//     на всех получателей, личное в нём выделено отдельным параметром — тот же
//     приём, что у pFlags.out и chosen_order.
//
// Не производятся (предмета нет, назван в разборе): `min`, `noforwards`, `out`,
// `albums`, `music`, `from_id` (автора несёт группа `peerStories.peer`, а у
// плоских списков — пир запроса, ровно как у оригинала).
//
// `id` — НОМЕР ВНУТРИ АВТОРА, а не ключ строки: им история и адресуется
// снаружи, и по нему же считается горизонт прочтения.
type StoryItemReal struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int             `json:"id"`
	// Date — обязательный, секунды эпохи (было created_at ISO-строкой).
	Date int64 `json:"date"`
	// FwdFrom — flags.17?StoryFwdHeader: ссылка на исходную историю у репоста.
	FwdFrom *StoryFwdHeader `json:"fwd_from,omitempty"`
	// ExpireDate — обязательный, секунды эпохи (было expires_at ISO-строкой).
	ExpireDate int64 `json:"expire_date"`
	// Caption — flags.0?string: подписи может не быть вовсе, и это ОТСУТСТВИЕ
	// параметра, а не пустая строка.
	Caption string `json:"caption,omitempty"`
	// Entities — flags.1?Vector<MessageEntity>: подпись истории размечена тем же
	// объединением, что и текст сообщения (Р11).
	Entities []MessageEntity `json:"entities,omitempty"`
	// Media — ОБЯЗАТЕЛЬНЫЙ: та же ступень, что у вложения сообщения.
	Media MessageMedia `json:"media"`
	// MediaAreas — flags.14?Vector<MediaArea>: интерактивные области.
	MediaAreas []MediaArea `json:"media_areas,omitempty"`
	// Privacy — flags.2?Vector<PrivacyRuleRecord>: аудитория. Едет ТОЛЬКО автору.
	Privacy []PrivacyRule `json:"privacy,omitempty"`
	// Views — flags.3?StoryViews: просмотры и агрегат реакций.
	Views *StoryViews `json:"views,omitempty"`
	// SentReaction — flags.15?Reaction: реакция ЗРИТЕЛЯ. «Не реагировал» —
	// отсутствие параметра.
	SentReaction Reaction `json:"sent_reaction,omitempty"`
}

func (StoryItemReal) isStoryItem()  {}
func (s StoryItemReal) Tag() string { return s.Underscore }

// storyItemDeleted#51e6ee4f id:int = StoryItem;
//
// «Историю удалили». Наш кадр `story_deleted` был вторым способом сказать то же
// самое — выбор конструктора внутри `updateStory` его заменяет (Р2, шаг D).
type StoryItemDeleted struct {
	Underscore string `json:"_"`
	ID         int    `json:"id"`
}

func (StoryItemDeleted) isStoryItem()  {}
func (s StoryItemDeleted) Tag() string { return s.Underscore }

// NewStoryItemDeleted — «этой истории больше нет».
func NewStoryItemDeleted(id int) StoryItemDeleted {
	return StoryItemDeleted{Underscore: StoryItemDeletedTag, ID: id}
}

// ── StoryViews: просмотры и агрегат реакций ─────────────────────────────────

// storyViews#8d595cd6 flags:# has_viewers:flags.1?true views_count:int
// forwards_count:flags.2?int reactions:flags.3?Vector<ReactionCount>
// reactions_count:flags.4?int recent_viewers:flags.0?Vector<long> = StoryViews;
//
// Наша тройка ключей верхнего уровня (reactions_count/my_reaction/reactions)
// схлопывается сюда — кроме `my_reaction`: он пер-зрительский и живёт
// параметром самой истории (`sent_reaction`).
//
// Разбивка переходит на тот же MTReactionCount с chosen_order, которым уже
// пользуется сообщение. Плоский domain.ReactionCount{Emoji,Count,Mine} остаётся
// ВНУТРИ репозиториев — на провод он больше не выходит (Р5).
//
// Не производятся: has_viewers (список зрителей у нас виден автору всегда),
// forwards_count (счётчика пересылок у историй нет — это же фиксирует
// storyrepo.go), recent_viewers (последних зрителей не отдаём — есть полный
// список отдельной ручкой).
type StoryViews struct {
	Underscore string `json:"_"`
	// ViewsCount — обязательный: сколько раз историю посмотрели.
	ViewsCount int `json:"views_count"`
	// Reactions — flags.3?Vector<ReactionCount>: разбивка по эмодзи.
	Reactions []MTReactionCount `json:"reactions,omitempty"`
	// ReactionsCount — flags.4?int: сколько реакций всего.
	ReactionsCount int `json:"reactions_count,omitempty"`
}

// NewStoryViews — просмотры истории с агрегатом реакций.
func NewStoryViews(views int, reactions []MTReactionCount, reactionsCount int) StoryViews {
	return StoryViews{
		Underscore:     StoryViewsTag,
		ViewsCount:     views,
		Reactions:      reactions,
		ReactionsCount: reactionsCount,
	}
}

// storyFwdHeader#b826e150 flags:# modified:flags.3?true from:flags.0?Peer
// from_name:flags.1?string story_id:flags.2?int = StoryFwdHeader;
//
// Атрибуция репоста. Наш `author_id: int64` становится `from: Peer` — тем же
// ходом, каким после порта пиров стали ссылками все остальные авторы (Р7).
//
// Не производятся: `from_name` (репоста от скрытого автора у нас нет — источник
// всегда известен) и `modified` (подпись репоста мы не правим).
type StoryFwdHeader struct {
	Underscore string `json:"_"`
	// From — flags.0?Peer: автор исходной истории.
	From Peer `json:"from,omitempty"`
	// StoryID — flags.2?int: номер исходной истории.
	StoryID int `json:"story_id,omitempty"`
}

// NewStoryFwdHeader — ссылка репоста на исходную историю.
func NewStoryFwdHeader(from Peer, storyID int) StoryFwdHeader {
	return StoryFwdHeader{Underscore: StoryFwdHeaderTag, From: from, StoryID: storyID}
}

// storyView#b0bdeac5 flags:# blocked:flags.0?true
// blocked_my_stories_from:flags.1?true user_id:long date:int
// reaction:flags.2?Reaction = StoryView;
//
// ОДИН просмотр. Наша ручка `/stories/{id}/viewers` отдавала голые карточки
// пользователей, теряя `date` (когда посмотрел — предмет ЕСТЬ, колонка
// story_views.viewed_at) и `reaction` (чем отреагировал). Здесь оба на месте.
//
// Не производятся: `blocked`/`blocked_my_stories_from` (чёрного списка историй
// нет), а также конструкторы storyViewPublicForward/storyViewPublicRepost —
// публичных пересылок и репостов-ответов у нас нет вовсе.
type StoryView struct {
	Underscore string `json:"_"`
	UserID     int64  `json:"user_id"`
	// Date — обязательный, секунды эпохи.
	Date int64 `json:"date"`
	// Reaction — flags.2?Reaction: чем зритель отреагировал, если отреагировал.
	Reaction Reaction `json:"reaction,omitempty"`
}

// NewStoryView — один просмотр истории.
func NewStoryView(userID int64, date int64, reaction Reaction) StoryView {
	return StoryView{Underscore: StoryViewTag, UserID: userID, Date: date, Reaction: reaction}
}

// ── MediaArea: объединение вместо строки `type` ─────────────────────────────

// MediaArea — интерактивная область поверх истории. У нас это была ОДНА
// структура с полем `type` и восемью необязательными полями, из которых
// заполнялась своя половина; в схеме — семь разных конструкторов (Р6).
type MediaArea interface {
	isMediaArea()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
	// Coords — общий блок положения области.
	Coords() MediaAreaCoordinates
}

// mediaAreaCoordinates#cfc9e002 flags:# x:double y:double w:double h:double
// rotation:double radius:flags.0?double = MediaAreaCoordinates;
//
// Общий блок всех областей: положение в процентах бокса медиа, поворот в
// градусах. Совпадает с нашим почти буквально — расходится один параметр,
// `radius` (круглая область), которого мы не производим.
type MediaAreaCoordinates struct {
	Underscore string  `json:"_"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	W          float64 `json:"w"`
	H          float64 `json:"h"`
	Rotation   float64 `json:"rotation"`
}

// NewMediaAreaCoordinates — положение области на истории.
func NewMediaAreaCoordinates(x, y, w, h, rotation float64) MediaAreaCoordinates {
	return MediaAreaCoordinates{
		Underscore: MediaAreaCoordinatesTag,
		X:          x, Y: y, W: w, H: h, Rotation: rotation,
	}
}

// mediaAreaGeoPoint#cad5452d flags:# coordinates:MediaAreaCoordinates
// geo:GeoPoint address:flags.0?GeoPointAddress = MediaArea;
//
// Точка на карте поверх истории. Наши `lat`/`long` рядом с координатами области
// становятся ступенью `geoPoint` — тем же объектом, каким едет гео-вложение
// сообщения.
//
// Не производится `address` (GeoPointAddress: страна/город/улица) — почтового
// разбора точки у нас нет.
type MediaAreaGeoPoint struct {
	Underscore  string               `json:"_"`
	Coordinates MediaAreaCoordinates `json:"coordinates"`
	Geo         GeoPoint             `json:"geo"`
}

func (MediaAreaGeoPoint) isMediaArea()  {}
func (a MediaAreaGeoPoint) Tag() string { return a.Underscore }

// NewMediaAreaGeoPoint — гео-область истории.
func NewMediaAreaGeoPoint(c MediaAreaCoordinates, lat, long float64) MediaAreaGeoPoint {
	return MediaAreaGeoPoint{Underscore: MediaAreaGeoPointTag, Coordinates: c, Geo: NewGeoPoint(lat, long)}
}

// mediaAreaVenue#be82db9c coordinates:MediaAreaCoordinates geo:GeoPoint
// title:string address:string provider:string venue_id:string
// venue_type:string = MediaArea;
//
// Место с названием. Три реквизита СПРАВОЧНИКА мест (foursquare/gplaces) —
// provider/venue_id/venue_type — предмета не имеют: справочника у нас нет,
// точку с подписью присылает сам автор. Ровно тот же пропуск и по той же
// причине уже объявлен у messageMediaVenue (domain.OmittedWithoutSubject), и
// здесь он объявляется там же — на проводе TL обязательный параметр занимает
// место в потоке, поэтому кодек пишет за него пустое значение.
type MediaAreaVenue struct {
	Underscore  string               `json:"_"`
	Coordinates MediaAreaCoordinates `json:"coordinates"`
	Geo         GeoPoint             `json:"geo"`
	Title       string               `json:"title"`
	Address     string               `json:"address"`
}

func (MediaAreaVenue) isMediaArea()  {}
func (a MediaAreaVenue) Tag() string { return a.Underscore }

// NewMediaAreaVenue — область-место истории.
func NewMediaAreaVenue(c MediaAreaCoordinates, lat, long float64, title, address string) MediaAreaVenue {
	return MediaAreaVenue{
		Underscore: MediaAreaVenueTag, Coordinates: c, Geo: NewGeoPoint(lat, long),
		Title: title, Address: address,
	}
}

// mediaAreaSuggestedReaction#14455871 flags:# dark:flags.0?true
// flipped:flags.1?true coordinates:MediaAreaCoordinates
// reaction:Reaction = MediaArea;
//
// Наклейка «отреагируй этим». Наш `reaction: string` (голое эмодзи) становится
// объединением `Reaction` — тем же, которым едут реакции сообщения; оформление
// (`dark`/`flipped`) уезжает в pFlags, где оно и должно быть.
type MediaAreaSuggestedReaction struct {
	Underscore  string               `json:"_"`
	PFlags      map[string]bool      `json:"pFlags,omitempty"`
	Coordinates MediaAreaCoordinates `json:"coordinates"`
	Reaction    Reaction             `json:"reaction"`
}

func (MediaAreaSuggestedReaction) isMediaArea()  {}
func (a MediaAreaSuggestedReaction) Tag() string { return a.Underscore }

// UnmarshalJSON нужен из-за одного параметра: `reaction` — ОБЪЕДИНЕНИЕ, а в
// интерфейс encoding/json разбирать не умеет. Остальные поля читаются как есть
// через теневой тип, чтобы не переписывать их руками.
func (a *MediaAreaSuggestedReaction) UnmarshalJSON(raw []byte) error {
	type shadow MediaAreaSuggestedReaction
	var v struct {
		shadow
		Reaction json.RawMessage `json:"reaction"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*a = MediaAreaSuggestedReaction(v.shadow)
	tag, ok, err := peekTag(v.Reaction)
	if err != nil {
		return err
	}
	if ok && tag == ReactionEmojiTag {
		e, err := unmarshalCtor[ReactionEmoji](v.Reaction)
		if err != nil {
			return err
		}
		a.Reaction = e
	}
	return nil
}

// NewMediaAreaSuggestedReaction — наклейка предложенной реакции.
func NewMediaAreaSuggestedReaction(c MediaAreaCoordinates, emoticon string, dark, flipped bool) MediaAreaSuggestedReaction {
	a := MediaAreaSuggestedReaction{
		Underscore: MediaAreaSuggestedReactionTag, Coordinates: c,
		Reaction: NewReactionEmoji(emoticon),
	}
	setPFlag(&a.PFlags, "dark", dark)
	setPFlag(&a.PFlags, "flipped", flipped)
	return a
}

// mediaAreaUrl#37381085 coordinates:MediaAreaCoordinates url:string = MediaArea;
//
// Кликабельная ссылка поверх истории.
type MediaAreaURL struct {
	Underscore  string               `json:"_"`
	Coordinates MediaAreaCoordinates `json:"coordinates"`
	URL         string               `json:"url"`
}

func (MediaAreaURL) isMediaArea()  {}
func (a MediaAreaURL) Tag() string { return a.Underscore }

// NewMediaAreaURL — область-ссылка истории.
func NewMediaAreaURL(c MediaAreaCoordinates, url string) MediaAreaURL {
	return MediaAreaURL{Underscore: MediaAreaURLTag, Coordinates: c, URL: url}
}

// MediaAreas — Vector<MediaArea>. Именованный тип нужен ради UnmarshalJSON: в
// объединение по дискриминатору encoding/json сам не умеет.
//
// Разбор нужен ДВУМ читателям, и оба настоящие: тело запроса на публикацию
// истории и колонка `stories.media_areas` (jsonb). Пока области хранились
// плоской записью с полем `type`, это были две разные формы одного предмета —
// вход и хранилище против витрины; теперь форма одна на всём пути.
type MediaAreas []MediaArea

// UnmarshalJSON разбирает вектор, ветвясь по дискриминатору `_`. Элемент с
// неизвестным конструктором ОТБРАСЫВАЕТСЯ, а не роняет весь список — то же
// правило и та же причина, что у Reactions: чужой слой может прислать область,
// которой у нас нет, и терять из-за неё всю историю нельзя.
func (as *MediaAreas) UnmarshalJSON(raw []byte) error {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return err
	}
	out := make(MediaAreas, 0, len(items))
	for _, item := range items {
		tag, ok, err := peekTag(item)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		var (
			v MediaArea
			e error
		)
		switch tag {
		case MediaAreaGeoPointTag:
			v, e = unmarshalCtor[MediaAreaGeoPoint](item)
		case MediaAreaVenueTag:
			v, e = unmarshalCtor[MediaAreaVenue](item)
		case MediaAreaSuggestedReactionTag:
			v, e = unmarshalCtor[MediaAreaSuggestedReaction](item)
		case MediaAreaURLTag:
			v, e = unmarshalCtor[MediaAreaURL](item)
		default:
			continue
		}
		if e != nil {
			return e
		}
		out = append(out, v)
	}
	*as = out
	return nil
}

// Coordinates — общий блок любой области. Метод, а не поле интерфейса: у
// объединения нет общего носителя, а вопрос «где она лежит» задаётся всем
// четырём конструкторам одинаково.
func (a MediaAreaGeoPoint) Coords() MediaAreaCoordinates          { return a.Coordinates }
func (a MediaAreaVenue) Coords() MediaAreaCoordinates             { return a.Coordinates }
func (a MediaAreaSuggestedReaction) Coords() MediaAreaCoordinates { return a.Coordinates }
func (a MediaAreaURL) Coords() MediaAreaCoordinates               { return a.Coordinates }

// ── PrivacyRule: аудитория истории ─────────────────────────────────────────

// PrivacyRule — объединение `PrivacyRule` схемы: одно правило аудитории.
//
// Здесь объявлена РАЗРЕШАЮЩАЯ половина объединения (её производят истории);
// запрещающая — в mtprivacy.go, вместе с ключами настроек приватности. Одно
// объединение, один интерфейс: тот же предмет, а не два похожих.
//
// Префикса MT у типа больше нет. Он стоял, пока имя `PrivacyRule` в пакете
// занимала НАША запись настроек (ключ + базовое значение + исключения) — и
// уходит вместе с её портом: запись стала `PrivacyRuleRecord`, по приёму
// UserRecord/ChatRecord/StoryRecord.
type PrivacyRule interface {
	isPrivacyRule()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// privacyValueAllowAll#65427b82 = PrivacyRule;
//
// Наш `privacy: "everyone"`.
type PrivacyValueAllowAll struct {
	Underscore string `json:"_"`
}

func (PrivacyValueAllowAll) isPrivacyRule() {}
func (r PrivacyValueAllowAll) Tag() string  { return r.Underscore }

// privacyValueAllowContacts#fffe1bac = PrivacyRule;
//
// Наш `privacy: "contacts"`.
type PrivacyValueAllowContacts struct {
	Underscore string `json:"_"`
}

func (PrivacyValueAllowContacts) isPrivacyRule() {}
func (r PrivacyValueAllowContacts) Tag() string  { return r.Underscore }

// privacyValueAllowCloseFriends#f7e8d89b = PrivacyRule;
//
// Наш `privacy: "close"`.
type PrivacyValueAllowCloseFriends struct {
	Underscore string `json:"_"`
}

func (PrivacyValueAllowCloseFriends) isPrivacyRule() {}
func (r PrivacyValueAllowCloseFriends) Tag() string  { return r.Underscore }

// privacyValueAllowUsers#b8905fb2 users:Vector<long> = PrivacyRule;
//
// Наш `allow_user_ids`, лежавший отдельным ключом рядом со строкой `privacy`.
type PrivacyValueAllowUsers struct {
	Underscore string  `json:"_"`
	Users      []int64 `json:"users"`
}

func (PrivacyValueAllowUsers) isPrivacyRule() {}
func (r PrivacyValueAllowUsers) Tag() string  { return r.Underscore }

// StoryPrivacyRules переводит нашу строку приватности и allow-лист в вектор
// правил схемы. Пустой результат означает «аудиторию не показываем» — так и
// уезжает чужому зрителю, которому `privacy` не адресован вовсе.
func StoryPrivacyRules(privacy string, allowIDs []int64) []PrivacyRule {
	switch privacy {
	case "everyone":
		return []PrivacyRule{PrivacyValueAllowAll{Underscore: PrivacyValueAllowAllTag}}
	case "contacts":
		return []PrivacyRule{PrivacyValueAllowContacts{Underscore: PrivacyValueAllowContactsTag}}
	case "close":
		return []PrivacyRule{PrivacyValueAllowCloseFriends{Underscore: PrivacyValueAllowCloseFriendsTag}}
	case "selected":
		return []PrivacyRule{PrivacyValueAllowUsers{
			Underscore: PrivacyValueAllowUsersTag, Users: orEmpty(allowIDs),
		}}
	}
	return nil
}

// StoryPrivacyPFlags — те же четыре значения, но флагами самой истории. Вектор
// правил едет ТОЛЬКО автору, а флаг видит любой зритель: по нему рисуется
// иконка «близкие друзья» и подобные. Это не дубль — у оригинала так же, и
// делят они работу ровно по этой границе.
func StoryPrivacyPFlags(privacy string) map[string]bool {
	var pf map[string]bool
	switch privacy {
	case "everyone":
		setPFlag(&pf, "public", true)
	case "contacts":
		setPFlag(&pf, "contacts", true)
	case "close":
		setPFlag(&pf, "close_friends", true)
	case "selected":
		setPFlag(&pf, "selected_contacts", true)
	}
	return pf
}

// ── Контейнеры ──────────────────────────────────────────────────────────────

// peerStories#9a35e999 flags:# peer:Peer max_read_id:flags.0?int
// stories:Vector<StoryItem> = PeerStories;
//
// Группа историй одного автора. Наш `{author: User, stories: […]}` держал
// КАРТОЧКУ автора внутри группы — ту же болезнь порт диалогов уже лечил
// (решение Р1 разбора диалогов): объекты едут ОДИН раз векторами users/chats
// контейнера, а внутри стоят ссылки (Р8).
//
// `max_read_id` — горизонт прочтения, который заменит признак `viewed` на
// каждой истории. Пока пер-авторской нумерации нет, параметр не производится
// (шаг E, Р3).
type PeerStories struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
	// MaxReadID — flags.0?int: ГОРИЗОНТ прочтения. Один номер на автора вместо
	// признака на каждой истории; «непрочитанная» выводит клиент сравнением, как
	// у сообщения с `read_inbox_max_id`. Ноль — не читал ни одной, и тогда
	// параметр не едет вовсе.
	MaxReadID int64       `json:"max_read_id,omitempty"`
	Stories   []StoryItem `json:"stories"`
}

// NewPeerStories — группа историй автора вместе с горизонтом прочтения зрителя.
func NewPeerStories(peer Peer, maxReadID int64, stories []StoryItem) PeerStories {
	return PeerStories{Underscore: PeerStoriesTag, Peer: peer, MaxReadID: maxReadID, Stories: orEmpty(stories)}
}

// storiesStealthMode#712e27fd flags:# active_until_date:flags.0?int
// cooldown_until_date:flags.1?int = StoriesStealthMode;
//
// Окно «невидимого просмотра». Наши ISO-строки с `null` становятся секундами
// эпохи, а «окна нет» — ОТСУТСТВИЕМ параметра, а не значением null (Р10).
type StoriesStealthMode struct {
	Underscore        string `json:"_"`
	ActiveUntilDate   int64  `json:"active_until_date,omitempty"`
	CooldownUntilDate int64  `json:"cooldown_until_date,omitempty"`
}

// NewStoriesStealthMode — окно stealth-режима; нулевая граница не едет вовсе.
func NewStoriesStealthMode(activeUntil, cooldownUntil int64) StoriesStealthMode {
	return StoriesStealthMode{
		Underscore:        StoriesStealthModeTag,
		ActiveUntilDate:   activeUntil,
		CooldownUntilDate: cooldownUntil,
	}
}

// stories.allStories#6efc5e81 flags:# has_more:flags.0?true count:int
// state:string peer_stories:Vector<PeerStories> chats:Vector<Chat>
// users:Vector<User> stealth_mode:StoriesStealthMode = stories.AllStories;
//
// Контейнер ленты историй — ответ `GET /stories`. Карточки авторов уезжают в
// вектор `users`, а сам stealth-режим приезжает ВМЕСТЕ с лентой, как у
// оригинала (отдельная ручка при этом остаётся: активация у оригинала тоже
// отдельный метод).
//
// Не производятся: `has_more` и `state` — курсора у ленты историй нет, она
// отдаётся целиком.
type StoriesAllStories struct {
	Underscore  string             `json:"_"`
	Count       int                `json:"count"`
	PeerStories []PeerStories      `json:"peer_stories"`
	Chats       []Chat             `json:"chats"`
	Users       []User             `json:"users"`
	StealthMode StoriesStealthMode `json:"stealth_mode"`
}

// NewStoriesAllStories — контейнер ленты историй.
func NewStoriesAllStories(groups []PeerStories, users []User, stealth StoriesStealthMode) StoriesAllStories {
	return StoriesAllStories{
		Underscore:  StoriesAllStoriesTag,
		Count:       len(groups),
		PeerStories: orEmpty(groups),
		Chats:       []Chat{},
		Users:       orEmpty(users),
		StealthMode: stealth,
	}
}

// stories.stories#63c3dd0a flags:# count:int stories:Vector<StoryItem>
// pinned_to_top:flags.0?Vector<int> chats:Vector<Chat> users:Vector<User>
// = stories.Stories;
//
// Плоский список историй — ответы `GET /stories/archive` и `/stories/pinned`.
//
// Не производится `pinned_to_top`: «закреплено наверху профиля» у нас нет —
// есть только сам закреп (`pFlags.pinned` истории).
type StoriesStories struct {
	Underscore string      `json:"_"`
	Count      int         `json:"count"`
	Stories    []StoryItem `json:"stories"`
	Chats      []Chat      `json:"chats"`
	Users      []User      `json:"users"`
}

// NewStoriesStories — плоский список историй с картотекой пиров.
func NewStoriesStories(stories []StoryItem, users []User) StoriesStories {
	return StoriesStories{
		Underscore: StoriesStoriesTag,
		Count:      len(stories),
		Stories:    orEmpty(stories),
		Chats:      []Chat{},
		Users:      orEmpty(users),
	}
}

// stories.storyViewsList#59d78fc5 flags:# count:int views_count:int
// forwards_count:int reactions_count:int views:Vector<StoryView>
// chats:Vector<Chat> users:Vector<User> next_offset:flags.0?string
// = stories.StoryViewsList;
//
// Ответ `GET /stories/{id}/viewers`. Наш `{viewers: [User], count}` терял и
// дату просмотра, и реакцию зрителя — оба лежат в `storyView` (Р9).
//
// `forwards_count` едет нулём, и это ЗНАЧЕНИЕ, а не заглушка: пересылок у
// историй нет вовсе. `next_offset` не производится — список отдаётся целиком.
type StoriesStoryViewsList struct {
	Underscore     string      `json:"_"`
	Count          int         `json:"count"`
	ViewsCount     int         `json:"views_count"`
	ForwardsCount  int         `json:"forwards_count"`
	ReactionsCount int         `json:"reactions_count"`
	Views          []StoryView `json:"views"`
	Chats          []Chat      `json:"chats"`
	Users          []User      `json:"users"`
}

// NewStoriesStoryViewsList — список просмотров истории с картотекой зрителей.
func NewStoriesStoryViewsList(views []StoryView, users []User, reactionsCount int) StoriesStoryViewsList {
	return StoriesStoryViewsList{
		Underscore:     StoriesStoryViewsListTag,
		Count:          len(views),
		ViewsCount:     len(views),
		ReactionsCount: reactionsCount,
		Views:          orEmpty(views),
		Chats:          []Chat{},
		Users:          orEmpty(users),
	}
}
