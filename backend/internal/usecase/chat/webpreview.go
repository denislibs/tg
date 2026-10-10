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

// previewURL — по какой ссылке строить превью сообщения с этим текстом; "" —
// не строить. no_webpage сильнее всего, затем явный выбор композера
// (inputMediaWebPage), затем первая ссылка текста.
func previewURL(w domain.WebPageInput, text string, entities domain.MessageEntities) string {
	if w.NoWebpage {
		return ""
	}
	if u := w.MediaURL(); u != "" {
		return u
	}
	return firstURL(text, entities)
}

// sameURL — две записи одной ссылки (снимок хранит адрес в разборе url.Parse,
// текст — как его набрали).
func sameURL(a, b string) bool {
	if a == b {
		return true
	}
	ua, ea := neturl.Parse(a)
	ub, eb := neturl.Parse(b)
	return ea == nil && eb == nil && ua.String() == ub.String()
}

// webPageInputOf — необязательный хвостовой аргумент EditMessage: внутренние
// вызовы (тесты, боты) его не передают.
func webPageInputOf(opt []domain.WebPageInput) (domain.WebPageInput, bool) {
	if len(opt) == 0 {
		return domain.WebPageInput{}, false
	}
	return opt[0], true
}

// startSendWebPreview — превью нового сообщения после коммита Send, только
// если строка вставлена этим вызовом: recipients у лички/группы, channel — у
// поста (дубль по client_msg_id превью второй раз не строит).
func (i *Interactor) startSendWebPreview(msg domain.Message, in SendInput, recipients []int64, channel bool) {
	if recipients == nil && !channel {
		return
	}
	i.startWebPreview(msg, in.WebPage, recipients)
}

// startWebPreview — фоновая сборка превью только что записанного сообщения.
// Только текст: у медиа с подписью превью нет, служебное не text, секретный
// чат отсекает attachWebPreview. Ссылку выбирает domain.WebPageInput. Карточка уже
// есть (копия, опубликованное отложенное) — собирать нечего.
func (i *Interactor) startWebPreview(msg domain.Message, in domain.WebPageInput, recipients []int64) {
	if i.preview == nil || msg.Type != "text" || msg.WebPage != nil {
		return
	}
	if u := previewURL(in, msg.Text, msg.Entities); u != "" {
		go i.attachWebPreview(msg, u, recipients, in)
	}
}

// updateTextWithWebPage — запись правки текста ВМЕСТЕ с превью и флагом
// invert_media, в транзакции EditMessage вместо голого UpdateText. Возвращает
// строку уже в том виде, в каком её получит кадр правки:
//   - ссылки не стало (или no_webpage) → превью снято, кадр правки без media
//     (так tweb снимает карточку — сообщение без медиа, appMessagesManager.ts
//     :7374-7377);
//   - ссылка та же, карточка есть → карточка остаётся, меняется только выбор
//     размера из inputMediaWebPage;
//   - ссылка другая (или карточки ещё нет) → старая карточка снимается, новую
//     после коммита строит rebuildWebPreviewOnEdit.
//
// Превью — только у текста (как в Send): у медиа с подписью его нет.
func (i *Interactor) updateTextWithWebPage(ctx context.Context, cur domain.Message, text string, entities domain.MessageEntities, opt []domain.WebPageInput) (domain.Message, error) {
	m, err := i.msgs.UpdateText(ctx, cur.ID, text, entities)
	if err != nil {
		return m, err
	}
	in, given := webPageInputOf(opt)
	// invert_media правки — состояние флага (TL: отсутствие = false). Без
	// аргумента (внутренний вызов) флаг не трогаем.
	if given && m.InvertMedia != in.InvertMedia {
		if err := i.msgs.SetInvertMedia(ctx, m.ID, in.InvertMedia); err != nil {
			return m, err
		}
		m.InvertMedia = in.InvertMedia
	}
	if cur.Type != "text" || m.WebPage == nil {
		return m, nil
	}
	next := keptWebPage(m.WebPage, previewURL(in, m.Text, m.Entities), in)
	if next == m.WebPage {
		return m, nil
	}
	if err := i.msgs.SetWebPage(ctx, m.ID, next); err != nil {
		return m, err
	}
	m.WebPage = next
	return m, nil
}

// keptWebPage — какая карточка переживает правку: та же ссылка — та же
// карточка (с выбором размера из media, если он передан), иначе — никакой.
// Возвращает cur, если менять нечего.
func keptWebPage(cur *domain.WebPagePreview, url string, in domain.WebPageInput) *domain.WebPagePreview {
	if url == "" || !sameURL(cur.URL, url) {
		return nil
	}
	if in.MediaURL() == "" {
		return cur
	}
	next := *cur
	in.ApplySize(&next)
	if next.ForceLargeMedia == cur.ForceLargeMedia && next.ForceSmallMedia == cur.ForceSmallMedia {
		return cur
	}
	return &next
}

// rebuildWebPreviewOnEdit — после коммита правки: у текста со ссылкой без
// карточки (ссылку сменили — updateTextWithWebPage карточку снял; или её ещё
// не было) строит новую. Запись условная по edited_at этой правки: следующая
// правка, пришедшая раньше, чем сайт ответил, побеждает (SetWebPageIfEdited).
// members — получатели кадра у лички/группы; у канала nil (журнал канала).
func (i *Interactor) rebuildWebPreviewOnEdit(msg domain.Message, opt []domain.WebPageInput, members []int64) {
	in, _ := webPageInputOf(opt)
	i.startWebPreview(msg, in, members)
}

// buildWebPreview собирает карточку ссылки: og-теги (Preview), картинка к нам
// (fetchPreviewPhoto, владелец — ownerID), проба Instant View. nil — карточки
// нет. Каждый сетевой этап — со своим бюджетом (см. таймауты выше).
func (i *Interactor) buildWebPreview(url string, ownerID int64) *domain.WebPagePreview {
	var wp *domain.WebPagePreview
	withBudget(previewTimeout, func(ctx context.Context) {
		if p, err := i.preview.Preview(ctx, url); err == nil {
			wp = p
		}
	})
	if wp == nil {
		return nil
	}
	// Обогащения — каждое со СВОИМ бюджетом, не из бюджета сбора (см. таймауты
	// выше): оба ходят в сеть ещё раз, и медленный сайт не должен стоить нам
	// карточки целиком.
	withBudget(enrichTimeout, func(ectx context.Context) {
		i.fetchPreviewPhoto(ectx, wp, ownerID)
	})
	// Проба Instant View — тем же путём, что и открытие статьи: результат ложится
	// в кэш iv-usecase, поэтому клик по кнопке отдаёт статью уже из него.
	if i.ivProbe != nil {
		withBudget(enrichTimeout, func(ictx context.Context) {
			wp.HasIV = i.ivProbe.HasArticle(ictx, wp.URL)
		})
	}
	return wp
}

// attachWebPreview строит превью ссылки уже записанного сообщения (go-рутиной
// ПОСЛЕ коммита Send или правки): buildWebPreview → условный UPDATE web_page →
// кадр всем участникам. Догоняющее и best-effort: любая ошибка просто оставляет
// сообщение без карточки (история при getDifference отдаст web_page, если
// UPDATE успел). Секретные чаты исключены — сервер их контент не трогает.
//
// Запись условная (SetWebPageIfEdited по msg.EditedAt): сборка идёт секундами,
// и если сообщение за это время правили, карточка от старого текста не должна
// ни перезаписать карточку новой правки, ни вернуть снятую. Не записалось —
// кадра нет.
//
// Пост broadcast-канала получает карточку правкой поста журналом канала
// (updateEditChannelMessage, writeChannelWebPreview): веера по подписчикам у
// канала нет, а догон канала (/channels/{id}/difference) обязан привезти
// карточку тому, кто пропустил живой кадр. recipients у канала не нужны.
// Зеркало поста в группе обсуждения получает ту же карточку
// (syncMirrorContent): оно создаётся в транзакции Send раньше, чем карточка
// готова, и иначе осталось бы без неё навсегда.
func (i *Interactor) attachWebPreview(msg domain.Message, url string, recipients []int64, in domain.WebPageInput) {
	// Фоновая горутина над чужим HTML (парсинг og/readability) — паника не должна
	// ронять процесс.
	defer saferun.Recover("chat.attachWebPreview")
	var typ string
	withBudget(writeTimeout, func(ctx context.Context) {
		typ, _ = i.chats.ChatType(ctx, msg.ChatID)
	})
	if typ == "" || typ == domain.ChatTypeSecret {
		return
	}
	wp := i.buildWebPreview(url, msg.SenderID)
	if wp == nil {
		return
	}
	in.ApplySize(wp)

	// Запись и фан-аут — тоже свой бюджет: к этому моменту бюджет сбора может
	// быть уже исчерпан, а терять собранную карточку из-за этого нельзя.
	withBudget(writeTimeout, func(wctx context.Context) {
		if typ == domain.ChatTypeChannel {
			i.writeChannelWebPreview(wctx, msg, wp)
			return
		}
		// Логируем + шлём web_page_update всем получателям: догоняющее превью
		// доезжает и через getDifference (плотный pts-курсор), а не только живым
		// кадром. Карточка едет ТЕМ ЖЕ конструктором, что и в самом сообщении
		// (messageMediaWebPage под ключом media).
		//
		// Условная запись и журнал — ОДНОЙ транзакцией: UPDATE держит строку до
		// коммита, и правка, пришедшая между ними, дождётся его и ляжет в журнал
		// ПОЗЖЕ карточки. Порознь правка могла бы снять только что записанную
		// карточку раньше, чем её кадр лёг в журнал, и догон вернул бы её клиенту.
		media := wp.ToMedia()
		var publish func(context.Context)
		_ = i.tx.WithinTx(wctx, func(ctx context.Context) error {
			if ok, err := i.msgs.SetWebPageIfEdited(ctx, msg.ID, wp, msg.EditedAt); err != nil || !ok {
				return err
			}
			var err error
			publish, err = i.appendPerPeer(ctx, msg.ChatID, recipients, "web_page_update",
				func(peer domain.PeerID) map[string]any {
					return map[string]any{
						"_": domain.UpdateMessageWebPageTag, "peer": domain.NewPeer(peer),
						"msg_id": msg.Seq, "media": media,
					}
				})
			return err
		})
		if publish != nil {
			publish(wctx)
		}
	})
}

// writeChannelWebPreview — карточка поста broadcast-канала: условная запись и
// правка поста в журнал канала одной транзакцией (см. attachWebPreview),
// живой кадр — после коммита, затем зеркало в группе обсуждения.
func (i *Interactor) writeChannelWebPreview(ctx context.Context, msg domain.Message, wp *domain.WebPagePreview) {
	var post domain.Message
	var body map[string]any
	var pts int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		ok, err := i.msgs.SetWebPageIfEdited(ctx, msg.ID, wp, msg.EditedAt)
		if err != nil || !ok {
			return err
		}
		m, err := i.msgs.GetByID(ctx, msg.ID)
		if err != nil {
			return err
		}
		if post, err = i.hydrateBroadcastMessage(ctx, m); err != nil {
			return err
		}
		body = i.channelEditPayload(ctx, post)
		pts, err = i.appendChannelUpdate(ctx, post.ChatID, "edit_message", body)
		return err
	})
	if err != nil || body == nil {
		return
	}
	i.publishChannelUpdate(ctx, post.ChatID, "edit_message", body, pts, post.SenderID)
	i.syncMirrorContent(ctx, post, false)
}

// GetWebPage — карточка ссылки для плашки над полем ввода, до отправки
// (messages.getWebPage; плашка tweb зовёт именно его: input.ts:3594 →
// appWebPagesManager.ts:273-284). nil — карточки нет (клиент получит
// webPageEmpty и плашку не покажет, input.ts:3600).
//
// Собирается только сама страница (og-теги): плашка показывает заголовок и
// описание (input.ts:3601-3605). Картинку к себе НЕ качаем: доступ к ней
// привязан к сообщению (messages.web_page_media_id, MediaAccessRepo), и до
// отправки её некому отдать, а скачанная на каждую набранную ссылку она
// копила бы в хранилище мусор. Пробу Instant View тоже не делаем — кнопка
// «Мгновенный просмотр» живёт на карточке в ленте, у плашки её нет. Карточку
// сообщения сервер строит сам при отправке (inputMediaWebPage несёт ссылку).
func (i *Interactor) GetWebPage(ctx context.Context, url string) *domain.WebPagePreview {
	url = strings.TrimSpace(url)
	if i.preview == nil || (!strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://")) {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, previewTimeout)
	defer cancel()
	wp, err := i.preview.Preview(ctx, url)
	if err != nil || wp == nil {
		return nil
	}
	wp.ImageURL = ""
	return wp
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
