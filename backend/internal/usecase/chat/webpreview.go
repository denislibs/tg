package chat

import (
	"context"
	neturl "net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/pkg/saferun"
)

// Бюджеты этапов превью. Работа идёт в фоне на context.Background(), поэтому
// «висящий» сайт не должен держать горутину бесконечно — но и один котёл на всё
// не годится: этапов, ходящих в сеть, теперь три (og-теги, картинка, проба
// Instant View), и общий таймаут означал бы, что медленный сайт съедает бюджет
// ДО записи и карточка теряется целиком. А она без картинки и без кнопки IV
// вполне рабочая — терять её из-за необязательного обогащения нельзя.
//
// var, а не const: тесты ужимают бюджеты, чтобы проверить именно это разделение
// (webpreview_photo_test.go), не простаивая секунды.
var (
	// previewTimeout — сбор og-тегов (загрузка + разбор страницы).
	previewTimeout = 15 * time.Second
	// enrichTimeout — КАЖДОЕ обогащение отдельно: картинка, проба IV.
	enrichTimeout = 10 * time.Second
	// writeTimeout — UPDATE + фан-аут кадра; свой, чтобы обогащения его не съели.
	writeTimeout = 5 * time.Second
)

var urlRe = regexp.MustCompile(`https?://\S+`)

// firstURL — первая http/https-ссылка сообщения: сначала messageEntityTextUrl
// (несут явный URL), затем голая ссылка в тексте. Пусто — ссылок нет.
func firstURL(text string, entities domain.MessageEntities) string {
	for _, e := range entities {
		v, ok := e.(domain.MessageEntityTextURL)
		if ok && (strings.HasPrefix(v.URL, "http://") || strings.HasPrefix(v.URL, "https://")) {
			return v.URL
		}
	}
	// Хвостовую пунктуацию («смотри https://a.b/c.») ссылкой не считаем.
	return strings.TrimRight(urlRe.FindString(text), `.,;:!?)»"'`)
}

// attachWebPreview строит превью первой ссылки уже отправленного сообщения
// (вызывается go-рутиной ПОСЛЕ коммита Send): Preview() → UPDATE web_page →
// кадр web_page_update всем участникам. Догоняющее и best-effort: любая ошибка
// просто оставляет сообщение без карточки (история при /sync отдаст web_page,
// если UPDATE успел). Секретные чаты исключены — сервер их контент не трогает.
func (i *Interactor) attachWebPreview(msg domain.Message, url string, recipients []int64) {
	// Фоновая горутина над чужим HTML (парсинг og/readability) — паника не должна
	// ронять процесс.
	defer saferun.Recover("chat.attachWebPreview")
	ctx, cancel := context.WithTimeout(context.Background(), previewTimeout)
	defer cancel()
	if typ, err := i.chats.ChatType(ctx, msg.ChatID); err != nil || typ == "secret" {
		return
	}
	wp, err := i.preview.Preview(ctx, url)
	if err != nil || wp == nil {
		return
	}
	// Обогащения — каждое со СВОИМ бюджетом, не из бюджета сбора (см. таймауты
	// выше): оба ходят в сеть ещё раз, и медленный сайт не должен стоить нам
	// карточки целиком.
	withBudget(enrichTimeout, func(ectx context.Context) {
		i.fetchPreviewPhoto(ectx, wp, msg.SenderID)
	})
	// Проба Instant View — тем же путём, что и открытие статьи: результат ложится
	// в кэш iv-usecase, поэтому клик по кнопке отдаёт статью уже из него.
	if i.ivProbe != nil {
		withBudget(enrichTimeout, func(ictx context.Context) {
			wp.HasIV = i.ivProbe.HasArticle(ictx, wp.URL)
		})
	}

	// Запись и фан-аут — тоже свой бюджет: к этому моменту бюджет сбора может
	// быть уже исчерпан, а терять собранную карточку из-за этого нельзя.
	withBudget(writeTimeout, func(wctx context.Context) {
		if err := i.msgs.SetWebPage(wctx, msg.ID, wp); err != nil {
			return
		}
		// Логируем + шлём web_page_update всем получателям: догоняющее превью доезжает
		// и через /sync (плотный pts-курсор), а не только живым кадром.
		_ = i.logAndPublish(wctx, recipients, "web_page_update", map[string]any{
			"chat_id": msg.ChatID, "msg_id": msg.ID, "seq": msg.Seq, "web_page": wp,
		})
	})
}

// withBudget выполняет шаг под собственным дедлайном от context.Background():
// шаги превью намеренно НЕ делят один бюджет (см. таймауты выше).
func withBudget(d time.Duration, fn func(context.Context)) {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	fn(ctx)
}

// maxPreviewPhoto — потолок картинки превью. og:image у крупных площадок — это
// 1280×720 jpeg на сотни килобайт; 5 МиБ с запасом закрывают их и отсекают
// «картинку» в десятки мегабайт, которой сайт мог бы нагрузить нам хранилище.
const maxPreviewPhoto = 5 << 20

// fetchPreviewPhoto забирает og:image К СЕБЕ и подменяет чужой адрес на наш
// media_id. Так работает Telegram: браузер участника чата за картинкой превью
// на чужой хост не ходит и свой IP владельцу ссылки не сдаёт (а наш CSP
// `img-src 'self' data: blob:` внешний адрес и так режет).
//
// Best-effort ровно как остальная сборка превью: сайт отдал не картинку, не
// ответил, превысил лимит — карточка просто остаётся без фото. Транзитный
// wp.ImageURL гасим в любом случае: наружу он не уходит (`json:"-"`), но и в
// снимке ему делать нечего.
func (i *Interactor) fetchPreviewPhoto(ctx context.Context, wp *domain.WebPagePreview, ownerID int64) {
	defer func() { wp.ImageURL = "" }()
	if wp.ImageURL == "" || i.botHTTP == nil || i.botMedia == nil {
		return
	}
	data, mime, err := i.botHTTP.FetchURL(ctx, wp.ImageURL, maxPreviewPhoto)
	if err != nil || !strings.HasPrefix(mime, "image/") {
		return
	}
	// Имя файла — из пути ссылки: оно попадает в media.file_name и видно только
	// в отладке, но осмысленное лучше пустого.
	name := path.Base(wp.ImageURL)
	if u, e := neturl.Parse(wp.ImageURL); e == nil {
		name = path.Base(u.Path)
	}
	if id, e := i.botMedia.Store(ctx, ownerID, mime, name, data); e == nil {
		wp.PhotoID = id
	}
}
