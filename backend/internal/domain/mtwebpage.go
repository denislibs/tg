package domain

import (
	"strings"
	"unicode/utf8"
)

// Превью ссылки в форме оригинала — конструкторы схемы TL. Правила фазы 0 — в
// шапке mtmedia.go.
//
// До этого шага превью ехало собственным ключом `web_page` строки витрины,
// записью WebPagePreview{url, site_name, title, description, photo_id, photo_w,
// photo_h, photo_blur, photo_has_thumb, has_iv}. В схеме это messageMediaWebPage
// с вложенным webPage — то есть НЕ приписка к сообщению, а такой же вид
// вложения, как фотография и документ.
//
// Отдельно про картинку превью. Пять полей photo_* — это ровно та плоская форма
// медиа (id + размеры + подложка + признак превью), ради устранения которой
// делался порт медиа: лестницы ступеней в ней нет, и клиент не может выбрать
// ступень тем же choosePhotoSize, которым выбирает её у любого другого фото.
// Порт медиа снял её у сообщения, но здесь она пережила его нетронутой — потому
// что жила в другом ключе. Теперь это webPage.photo:Photo, обычная лестница.

// Значения дискриминатора `_` подсистемы превью ссылки.
const (
	MessageMediaWebPageTag = "messageMediaWebPage"
	WebPageTag             = "webPage"
)

// messageMediaWebPage#ddf10c3b flags:# force_large_media:flags.0?true
// force_small_media:flags.1?true manual:flags.3?true safe:flags.4?true
// webpage:WebPage = MessageMedia;
//
// force_large_media/force_small_media — выбор отправителя «крупнее/мельче»
// (WebPagePreview.ForceLargeMedia/ForceSmallMedia, приходит из
// inputMediaWebPage отправки и правки).
//
// Не производятся: manual (превью «прикреплено вручную» — у нас ссылка
// превью всегда из текста сообщения), safe.
type MessageMediaWebPage struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	WebPage    *WebPage        `json:"webpage"`
}

func (MessageMediaWebPage) isMessageMedia() {}
func (m MessageMediaWebPage) Tag() string   { return m.Underscore }

// webPage#e89c45b2 flags:# has_large_media:flags.13?true
// video_cover_photo:flags.14?true id:long url:string display_url:string
// hash:int type:flags.0?string site_name:flags.1?string title:flags.2?string
// description:flags.3?string photo:flags.4?Photo embed_url:flags.5?string
// embed_type:flags.5?string embed_width:flags.6?int embed_height:flags.6?int
// duration:flags.7?int author:flags.8?string document:flags.9?Document
// cached_page:flags.10?Page attributes:flags.12?Vector<WebPageAttribute>
// = WebPage;
//
// САМА КАРТОЧКА. Имя структуры не повторяет имя строки витрины
// (WebPagePreview), которая живёт ещё один шаг.
//
// ── Обязательные параметры, которых мы не производим ────────────────────────
//   - id — идентификатор КЭШИРОВАННОЙ страницы на сервере оригинала: там превью
//     это самостоятельный объект, который живёт в своём хранилище и делится
//     между всеми сообщениями с той же ссылкой. У нас превью — СНИМОК на
//     сообщении (jsonb web_page), отдельного объекта не существует, и числа,
//     которым его можно было бы адресовать, тоже. Ноль здесь был бы не
//     «значением», а ссылкой на несуществующий объект;
//   - hash — хэш для кэширования запроса; хэш-кэширования запросов у нас нет
//     вовсе (тот же случай, что factCheck.hash и poll.hash).
//
// На фазе 2 оба станут заглушками-нулями в потоке.
//
// ── has_iv: НАШ параметр вне схемы ──────────────────────────────────────────
// Место статьи «Мгновенного просмотра» в схеме есть — cached_page:Page, — но
// предмета у НАС нет: Instant View назван собственной сущностью ещё решением
// программы (docs/readiness/tl-program.md, «Наши собственные сущности»), потому
// что наша статья это результат reader-парсера (domain.IVArticle с плоскими
// блоками), а Page оригинала — вёрстка по IV-шаблону из десятков конструкторов
// PageBlock. Отдать пустой page ради «кнопка есть» значило бы соврать про
// содержимое: клиент оригинала рисует футер именно по НАЛИЧИЮ cached_page
// (tweb bubbles.ts:7990), а саму статью у нас отдаёт своя ручка.
//
// ── has_large_media — по НАШЕМУ правилу ─────────────────────────────────────
// Флаг «картинку можно показать крупно»: без него tweb прячет выбор
// «крупнее/мельче» (input.ts:3619) и не учитывает force_* при отрисовке
// (bubbles.ts:9479-9480). Как решает сервер Telegram, из tweb не видно;
// правило — у сборки превью (usecase/chat largePreviewPhoto).
//
// Не производятся: type (классификации ссылки — 'photo'/'telegram_channel'/… —
// у нас нет), embed_* и duration (встраиваемого плеера не разбираем), author,
// document, attributes, video_cover_photo.
type WebPage struct {
	Underscore string `json:"_"`
	// PFlags — has_large_media (flags.13?true).
	PFlags map[string]bool `json:"pFlags,omitempty"`
	// URL — обязательный: адрес, по которому пойдёт клик.
	URL string `json:"url"`
	// DisplayURL — обязательный: тот же адрес БЕЗ схемы, как его показывают в
	// шапке карточки (tweb appSearchSuper.ts:1067 берёт из него хост).
	DisplayURL string `json:"display_url"`
	// SiteName/Title/Description — flags.1/2/3?string.
	SiteName    string `json:"site_name,omitempty"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	// Photo — flags.4?Photo: картинка превью ОБЫЧНОЙ лестницей ступеней, а не
	// россыпью photo_w/photo_h/photo_blur рядом.
	Photo *Photo `json:"photo,omitempty"`
	// HasIV — наш параметр: из страницы извлеклась статья «Мгновенного
	// просмотра» (см. докблок).
	HasIV bool `json:"has_iv,omitempty"`
}

// ToMedia — ЕДИНСТВЕННЫЙ перевод снимка превью в конструктор схемы.
func (w *WebPagePreview) ToMedia() *MessageMediaWebPage {
	if w == nil {
		return nil
	}
	page := &WebPage{
		Underscore:  WebPageTag,
		URL:         w.URL,
		DisplayURL:  displayURL(w.URL),
		SiteName:    w.SiteName,
		Title:       w.Title,
		Description: w.Description,
		HasIV:       w.HasIV,
	}
	setPFlag(&page.PFlags, "has_large_media", w.HasLargeMedia)
	if w.PhotoID > 0 {
		// Та же сборка лестницы, что у фотографии сообщения: ступени превью
		// плюс оригинал. Второй арифметики размеров у нас быть не должно.
		src := MediaSource{
			MediaID: w.PhotoID, Width: w.PhotoW, Height: w.PhotoH,
			Blur: w.PhotoBlur, HasThumb: w.PhotoHasThumb,
		}
		page.Photo = NewPhoto(w.PhotoID, src.sizes())
	}
	media := &MessageMediaWebPage{Underscore: MessageMediaWebPageTag, WebPage: page}
	setPFlag(&media.PFlags, "force_large_media", w.ForceLargeMedia)
	setPFlag(&media.PFlags, "force_small_media", w.ForceSmallMedia)
	return media
}

// ToWebPage — сама карточка без обёртки вложения: ответ messages.getWebPage.
func (w *WebPagePreview) ToWebPage() *WebPage {
	return w.ToMedia().WebPage
}

// webPageEmpty#211a1788 flags:# id:long url:flags.0?string = WebPage;
//
// «Превью у этой ссылки нет» — ответ messages.getWebPage, когда страница не
// дала карточки (не HTML, нет заголовка, сайт не ответил, адрес не http/https).
// id не производится по той же причине, что у webPage (см. его докблок).
// tweb такую карточку плашкой не показывает (input.ts:3600 ждёт `webPage`).
type WebPageEmpty struct {
	Underscore string `json:"_"`
	URL        string `json:"url,omitempty"`
}

const WebPageEmptyTag = "webPageEmpty"

// MessagesWebPage — messages.webPage#fd5e12bd webpage:WebPage
// chats:Vector<Chat> users:Vector<User> = messages.WebPage; ответ
// messages.getWebPage (плашка превью над полем ввода, tweb
// appWebPagesManager.ts:273-284). Карточка пиров не упоминает, векторы пусты.
type MessagesWebPage struct {
	Underscore string `json:"_"`
	WebPage    any    `json:"webpage"`
	Chats      []any  `json:"chats"`
	Users      []any  `json:"users"`
}

const MessagesWebPageTag = "messages.webPage"

// NewMessagesWebPage — ответ getWebPage: карточка либо webPageEmpty с адресом.
func NewMessagesWebPage(url string, wp *WebPagePreview) MessagesWebPage {
	var page any = WebPageEmpty{Underscore: WebPageEmptyTag, URL: url}
	if wp != nil {
		page = wp.ToWebPage()
	}
	return MessagesWebPage{Underscore: MessagesWebPageTag, WebPage: page, Chats: []any{}, Users: []any{}}
}

// inputMediaWebPage#c21b8849 flags:# force_large_media:flags.0?true
// force_small_media:flags.1?true optional:flags.2?true url:string = InputMedia;
//
// ВХОДНОЙ конструктор отправки и правки: «превью вот этой ссылки, такого
// размера» (tweb getInputMediaWebPage, appMessagesManager.ts:4866-4880). optional
// у нас ничего не меняет — превью и так не обязательно: не собралось —
// сообщение уходит без карточки, ошибки нет.
type InputMediaWebPage struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	URL        string          `json:"url"`
}

const InputMediaWebPageTag = "inputMediaWebPage"

// displayURL — адрес без схемы: ровно то, что оригинал кладёт в display_url.
// Отдельной колонки под него нет и не нужно — это представление того же URL.
func displayURL(raw string) string {
	for _, scheme := range []string{"https://", "http://"} {
		if strings.HasPrefix(raw, scheme) {
			return strings.TrimSuffix(raw[len(scheme):], "/")
		}
	}
	return strings.TrimSuffix(raw, "/")
}

// WebPageInput — что отправитель решил о превью ссылки: параметры TL
// messages.sendMessage/sendMedia и messages.editMessage (no_webpage,
// invert_media, media:inputMediaWebPage; tweb appMessagesManager.ts:2733-2753,
// :2207-2220). Решает композер: плашка превью над полем ввода
// (components/chat/input.ts:3533-3631), крестик на ней (:4139 → no_webpage),
// меню «выше/ниже, крупнее/мельче» (:830-838).
//
// Нулевое значение — «клиент ничего не решил»: превью по первой ссылке текста.
// Так шлёт и tweb, пока плашка ещё не получила карточку (getWebPagePromise,
// input.ts:4694), и так шлют все наши пути, у которых плашки нет. Ключи — имена
// параметров метода: тела отправки и правки несут их плоско, рядом с текстом.
type WebPageInput struct {
	// NoWebpage — превью не строить (и снять при правке).
	NoWebpage bool `json:"no_webpage,omitempty"`
	// InvertMedia — флаг сообщения «медиа над текстом».
	InvertMedia bool `json:"invert_media,omitempty"`
	// Media — inputMediaWebPage: превью ЭТОЙ ссылки и выбор размера.
	Media *InputMediaWebPage `json:"media,omitempty"`
}

// Normalized — то же решение без ложных pFlags у media (TL true-флаг:
// отсутствие = false); пустые pFlags — nil. Копия: исходник не меняется.
func (w WebPageInput) Normalized() WebPageInput {
	if w.Media == nil {
		return w
	}
	m := *w.Media
	m.PFlags = nil
	for k, v := range w.Media.PFlags {
		if v {
			if m.PFlags == nil {
				m.PFlags = map[string]bool{}
			}
			m.PFlags[k] = true
		}
	}
	w.Media = &m
	return w
}

// ForDraft — решение о превью, каким его хранит черновик: media только
// inputMediaWebPage с http(s)-ссылкой не длиннее maxURL рун и только флагами
// конструктора (force_large_media, force_small_media, optional); иное
// media — черновик с вложением, его у нас нет, — снимается.
func (w WebPageInput) ForDraft(maxURL int) WebPageInput {
	w = w.Normalized()
	if w.Media == nil {
		return w
	}
	u := w.MediaURL()
	if u == "" || utf8.RuneCountInString(u) > maxURL {
		w.Media = nil
		return w
	}
	m := InputMediaWebPage{Underscore: InputMediaWebPageTag, URL: u}
	for _, k := range []string{"force_large_media", "force_small_media", "optional"} {
		setPFlag(&m.PFlags, k, w.Media.PFlags[k])
	}
	w.Media = &m
	return w
}

// IsZero — решения о превью нет.
func (w WebPageInput) IsZero() bool {
	return !w.NoWebpage && !w.InvertMedia && w.Media == nil
}

// MediaURL — ссылка из inputMediaWebPage, если она http/https; иначе "".
// Чужая схема или чужой конструктор не ошибка: превью у tweb необязательное
// (optional), сообщение уходит без карточки.
func (w WebPageInput) MediaURL() string {
	if w.Media == nil || w.Media.Underscore != InputMediaWebPageTag {
		return ""
	}
	u := strings.TrimSpace(w.Media.URL)
	if l := strings.ToLower(u); !strings.HasPrefix(l, "http://") && !strings.HasPrefix(l, "https://") {
		return ""
	}
	return u
}

// ApplySize переносит выбор «крупнее/мельче» из inputMediaWebPage в снимок
// карточки (messageMediaWebPage.pFlags у оригинала, getInputMediaWebPage
// appMessagesManager.ts:4875-4876). Без media выбора нет — флаги сняты.
// Выбор имеет смысл только у карточки с has_large_media: tweb шлёт force_*
// лишь при нём (input.ts:2306-2307, :4165-4166) и без него их не рисует
// (bubbles.ts:9480) — у остальных флаги сняты.
func (w WebPageInput) ApplySize(wp *WebPagePreview) {
	var pf map[string]bool
	if w.MediaURL() != "" && wp.HasLargeMedia {
		pf = w.Media.PFlags
	}
	wp.ForceLargeMedia, wp.ForceSmallMedia = pf["force_large_media"], pf["force_small_media"]
}
