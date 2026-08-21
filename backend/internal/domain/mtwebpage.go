package domain

import "strings"

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
// Не производятся: force_large_media/force_small_media (отправитель у нас не
// выбирает размер карточки), manual (превью «прикреплено вручную» — у нас оно
// всегда автоматическое), safe.
type MessageMediaWebPage struct {
	Underscore string   `json:"_"`
	WebPage    *WebPage `json:"webpage"`
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
// Не производятся: type (классификации ссылки — 'photo'/'telegram_channel'/… —
// у нас нет), embed_* и duration (встраиваемого плеера не разбираем), author,
// document, attributes, has_large_media, video_cover_photo.
type WebPage struct {
	Underscore string `json:"_"`
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
	if w.PhotoID > 0 {
		// Та же сборка лестницы, что у фотографии сообщения: ступени превью
		// плюс оригинал. Второй арифметики размеров у нас быть не должно.
		src := MediaSource{
			MediaID: w.PhotoID, Width: w.PhotoW, Height: w.PhotoH,
			Blur: w.PhotoBlur, HasThumb: w.PhotoHasThumb,
		}
		page.Photo = NewPhoto(w.PhotoID, src.sizes())
	}
	return &MessageMediaWebPage{Underscore: MessageMediaWebPageTag, WebPage: page}
}

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
