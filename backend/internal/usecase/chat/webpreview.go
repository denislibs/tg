package chat

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // размеры og:image (largePreviewPhoto)
	_ "image/jpeg" // размеры og:image (largePreviewPhoto)
	_ "image/png"  // размеры og:image (largePreviewPhoto)
	"log"
	neturl "net/url"
	"path"
	"reflect"
	"regexp"
	"strings"
	"sync"
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
	return trimURLTail(urlRe.FindString(text))
}

// trimURLTail — хвост ссылки как у tweb: последний символ адреса — не из
// `.;,([]{}<>"'` (URL_REG_EXP, lib/richTextProcessor/index.ts:58), затем
// непарные закрывающие скобки срезаются (checkBrackets.ts,
// parseEntities.ts:51-55). «!», «?», «:» и «»» tweb оставляет в адресе — и мы:
// адрес из текста должен совпасть с тем, что клиент пришлёт в
// inputMediaWebPage.url.
func trimURLTail(u string) string {
	u = strings.TrimRight(u, `.;,([]{}<>"'`)
	opens, closes := strings.Count(u, "("), strings.Count(u, ")")
	for closes > opens && strings.HasSuffix(u, ")") {
		u = u[:len(u)-1]
		closes--
	}
	if opens > closes {
		u = strings.TrimRight(u, ")")
	}
	return u
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

// webPageInputOf — необязательный хвостовой аргумент EditMessage и правки
// бота: без него превью следует первой ссылке текста, invert_media не
// меняется (Bot API этих параметров у нас не принимает).
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
//
// Сборка той же ссылки уже идёт (правка во время сборки, ссылка не менялась) —
// второй не начинаем: идущая перенацеливается на эту правку (edited_at,
// выбор размера, получатели) и запишет карточку под неё (previewFlights).
func (i *Interactor) startWebPreview(msg domain.Message, in domain.WebPageInput, recipients []int64) {
	if i.preview == nil || msg.Type != "text" || msg.WebPage != nil {
		return
	}
	u := previewURL(in, msg.Text, msg.Entities)
	if u == "" {
		return
	}
	fl, started := i.previewFlights.join(fmt.Sprintf("m:%d", msg.ID), u, func(t *previewTarget) {
		t.editedAt, t.in, t.recipients = msg.EditedAt, in, recipients
	})
	if started {
		i.goBackground(func() { i.attachWebPreview(msg, fl) })
	}
}

// goBackground — фоновый хвост запроса под i.bg (Shutdown и тесты его ждут).
func (i *Interactor) goBackground(fn func()) {
	i.bg.Add(1)
	go func() {
		defer i.bg.Done()
		fn()
	}()
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

// builtPreview — собранная карточка и её картинка, скачанная, но ещё не
// сохранённая к нам: сохраняется только перед записью, которая ещё может
// состояться (storePreviewPhoto), иначе отброшенная сборка оставляла бы в
// хранилище файл без ссылки.
type builtPreview struct {
	wp  *domain.WebPagePreview
	img *previewImage
}

// buildWebPreview собирает карточку ссылки: og-теги (Preview), картинка
// (downloadPreviewPhoto), проба Instant View. nil — карточки нет. Каждый
// сетевой этап — со своим бюджетом (см. таймауты выше).
func (i *Interactor) buildWebPreview(url, key string) *builtPreview {
	// Ожидание идущей загрузки плашки и своя загрузка — каждое со своим
	// бюджетом: не дождались (или плашка ничего не дала) — грузим сами с
	// полным previewTimeout, а не с остатком.
	var wp *domain.WebPagePreview
	withBudget(previewTimeout, func(ctx context.Context) {
		wp = i.webPages.page(ctx, url)
	})
	if wp == nil {
		withBudget(previewTimeout, func(ctx context.Context) {
			wp = i.fetchPage(ctx, url, key)
		})
	}
	if wp == nil {
		return nil
	}
	b := &builtPreview{wp: wp}
	// Обогащения — каждое со СВОИМ бюджетом, не из бюджета сбора (см. таймауты
	// выше): оба ходят в сеть ещё раз, и медленный сайт не должен стоить нам
	// карточки целиком.
	withBudget(enrichTimeout, func(ectx context.Context) {
		b.img = i.downloadPreviewPhoto(ectx, wp)
	})
	// Проба Instant View — тем же путём, что и открытие статьи: результат ложится
	// в кэш iv-usecase, поэтому клик по кнопке отдаёт статью уже из него.
	if i.ivProbe != nil {
		withBudget(enrichTimeout, func(ictx context.Context) {
			wp.HasIV = i.ivProbe.HasArticle(ictx, wp.URL)
		})
	}
	return b
}

// attachWebPreview строит превью ссылки уже записанного сообщения (фоном ПОСЛЕ
// коммита Send или правки): buildWebPreview → условный UPDATE web_page → кадр
// всем участникам. Догоняющее и best-effort: любая ошибка просто оставляет
// сообщение без карточки (история при getDifference отдаст web_page, если
// UPDATE успел). Секретные чаты исключены — сервер их контент не трогает.
//
// Запись условная (SetWebPageIfEdited по edited_at цели): сборка идёт
// секундами, и если сообщение за это время правили, карточка от старого
// текста не должна ни перезаписать карточку новой правки, ни вернуть снятую.
// Правка, сохранившая ссылку, перенацеливает сборку (previewFlights) — тогда
// запись повторяется под её edited_at. Не записалось — кадра нет.
//
// Пост broadcast-канала получает карточку правкой поста журналом канала
// (updateEditChannelMessage, writeChannelWebPreview): веера по подписчикам у
// канала нет, а догон канала (/channels/{id}/difference) обязан привезти
// карточку тому, кто пропустил живой кадр. recipients у канала не нужны.
// Зеркало поста в группе обсуждения получает ту же карточку (mirrorSync в
// транзакции записи): оно создаётся в транзакции Send раньше, чем карточка
// готова, и иначе осталось бы без неё навсегда.
func (i *Interactor) attachWebPreview(msg domain.Message, fl *previewFlight) {
	// Фоновая горутина над чужим HTML (парсинг og/readability) — паника не должна
	// ронять процесс.
	defer saferun.Recover("chat.attachWebPreview")
	defer i.previewFlights.drop(fl)
	var typ string
	withBudget(writeTimeout, func(ctx context.Context) {
		var err error
		if typ, err = i.chats.ChatType(ctx, msg.ChatID); err != nil {
			log.Printf("webpreview: %s: тип чата не прочитан: %v", fl.key, err)
		}
	})
	if typ == "" {
		return
	}
	if typ == domain.ChatTypeSecret {
		return
	}
	b := i.buildWebPreview(fl.url, fl.key)
	if b == nil {
		return
	}
	// Запись и фан-аут — тоже свой бюджет: к этому моменту бюджет сбора может
	// быть уже исчерпан, а терять собранную карточку из-за этого нельзя.
	withBudget(writeTimeout, func(wctx context.Context) {
		for {
			t := i.previewFlights.target(fl)
			if b.img != nil && !i.messagePreviewWanted(wctx, msg.ID, t) {
				if i.previewFlights.settle(fl, t.gen) {
					log.Printf("webpreview: %s: карточка %s не нужна (сообщение правили или удалили)", fl.key, previewHost(fl.url))
					return
				}
				continue
			}
			i.storePreviewPhoto(wctx, b, msg.SenderID)
			wp := b.wp.Clone()
			t.in.ApplySize(wp)
			var ok bool
			var err error
			if typ == domain.ChatTypeChannel {
				ok, err = i.writeChannelWebPreview(wctx, msg.ID, t.editedAt, wp)
			} else {
				ok, err = i.writeChatWebPreview(wctx, msg, t, wp)
			}
			if ok {
				return
			}
			if err != nil {
				log.Printf("webpreview: %s: карточка %s не записана: %v", fl.key, previewHost(fl.url), err)
				return
			}
			if i.previewFlights.settle(fl, t.gen) {
				log.Printf("webpreview: %s: карточка %s не записана (условие записи: сообщение правили или удалили)", fl.key, previewHost(fl.url))
				return
			}
		}
	})
}

// messagePreviewWanted — запись под цель t ещё может состояться: строка не
// удалена, без карточки и с той же правкой (edited_at). Проверка ДО
// сохранения картинки к нам; окончательно решает условный UPDATE.
func (i *Interactor) messagePreviewWanted(ctx context.Context, msgID int64, t previewTarget) bool {
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		log.Printf("webpreview: m:%d: строка не прочитана: %v", msgID, err)
		return false
	}
	return !cur.Deleted && cur.WebPage == nil && sameTime(cur.EditedAt, t.editedAt)
}

func sameTime(a, b *time.Time) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && a.Equal(*b))
}

// writeChatWebPreview — карточка сообщения лички/группы: условная запись и
// web_page_update получателям. Логируем + шлём: догоняющее превью доезжает и
// через getDifference (плотный pts-курсор), а не только живым кадром.
// Карточка едет ТЕМ ЖЕ конструктором, что и в самом сообщении
// (messageMediaWebPage под ключом media).
//
// Условная запись и журнал — ОДНОЙ транзакцией: UPDATE держит строку до
// коммита, и правка, пришедшая между ними, дождётся его и ляжет в журнал
// ПОЗЖЕ карточки. Порознь правка могла бы снять только что записанную
// карточку раньше, чем её кадр лёг в журнал, и догон вернул бы её клиенту.
func (i *Interactor) writeChatWebPreview(ctx context.Context, msg domain.Message, t previewTarget, wp *domain.WebPagePreview) (bool, error) {
	media := wp.ToMedia()
	var publish func(context.Context)
	written := false
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		ok, err := i.msgs.SetWebPageIfEdited(ctx, msg.ID, wp, t.editedAt)
		if err != nil || !ok {
			return err
		}
		publish, err = i.appendPerPeer(ctx, msg.ChatID, t.recipients, "web_page_update",
			func(peer domain.PeerID) map[string]any {
				return map[string]any{
					"_": domain.UpdateMessageWebPageTag, "peer": domain.NewPeer(peer),
					"msg_id": msg.Seq, "media": media,
				}
			})
		written = err == nil
		return err
	})
	// Записано — только если закоммичено: упавший коммит откатил карточку, и
	// живой кадр по ней ушёл бы зря.
	if err != nil {
		return false, err
	}
	if publish != nil {
		publish(ctx)
	}
	return written, nil
}

// writeChannelWebPreview — карточка поста broadcast-канала: условная запись,
// правка поста в журнал канала и зеркало в группе обсуждения одной
// транзакцией (см. writeChatWebPreview), живые кадры — после коммита.
func (i *Interactor) writeChannelWebPreview(ctx context.Context, msgID int64, editedAt *time.Time, wp *domain.WebPagePreview) (bool, error) {
	var post domain.Message
	var body map[string]any
	var pts int64
	var mirror *editDelivery
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		ok, err := i.msgs.SetWebPageIfEdited(ctx, msgID, wp, editedAt)
		if err != nil || !ok {
			return err
		}
		m, err := i.msgs.GetByID(ctx, msgID)
		if err != nil {
			return err
		}
		if post, err = i.hydrateBroadcastMessage(ctx, m); err != nil {
			return err
		}
		body = i.channelEditPayload(ctx, post)
		if pts, err = i.appendChannelUpdate(ctx, post.ChatID, "edit_message", body); err != nil {
			return err
		}
		// Зеркало — в той же транзакции (mirrorSync БЭК-3): правка поста,
		// пришедшая после коммита, ляжет на зеркало позже карточки и не будет
		// перезаписана ею.
		mirror, err = i.mirrorSync(ctx, post, false)
		return err
	})
	if err != nil || body == nil {
		return false, err
	}
	i.publishChannelUpdate(ctx, post.ChatID, "edit_message", body, pts, post.SenderID)
	i.publishEdit(ctx, mirror)
	return true, nil
}

// startScheduledWebPreview — превью ОТЛОЖЕННОГО (спецификация Ф-5 п. 4.2.4):
// та же сборка, что у сообщения (buildWebPreview), запись в строку очереди и
// кадр updateNewScheduledMessage автору — правка отложенного тем же id (tweb
// onUpdateNewScheduledMessage → handleEditedMessage, appMessagesManager.ts
// :11773-11794; у tweb отложенное с ожидающим превью — свой ключ,
// appWebPagesManager.ts:202-204). При публикации готовая карточка уходит в
// сообщение без повторной сборки (publishScheduledRow → in.webPage); не
// успела — сообщение строит её само (startWebPreview).
//
// Запись условная (SetWebPageIfSame): правка текста или решения о превью,
// публикация и снятие за время сборки делают карточку ненужной — тогда ни
// записи, ни кадра. Правка, сохранившая ссылку, перенацеливает идущую сборку,
// а не начинает вторую. Секретный чат отложить нельзя (enqueueScheduled),
// копия пересылки несёт карточку источника.
func (i *Interactor) startScheduledWebPreview(row domain.ScheduledMessage) {
	choice := derefChoice(row.Params.WebPage)
	// Клиент явно выбрал карточку (inputMediaWebPage), а сборки не будет —
	// причина в лог: так пропадала карточка отложенного на стенде C2.
	skip := func(why string) {
		if choice.MediaURL() != "" {
			log.Printf("webpreview: s:%d: сборка не начата: %s", row.ID, why)
		}
	}
	switch {
	case i.preview == nil || i.scheduled == nil:
		skip("превью отключены")
		return
	case row.Type != "text":
		skip("тип " + row.Type)
		return
	case row.WebPage != nil || row.Params.Fwd != nil:
		return // карточка уже есть / копия пересылки
	}
	u := previewURL(choice, row.Text, row.Entities)
	if u == "" {
		skip("ссылки нет")
		return
	}
	fl, started := i.previewFlights.join(fmt.Sprintf("s:%d", row.ID), u, func(t *previewTarget) {
		t.text, t.entities, t.choice = row.Text, row.Entities, row.Params.WebPage
	})
	if !started {
		skip("перенацелена идущая сборка")
		return
	}
	i.goBackground(func() { i.attachScheduledWebPreview(row, fl) })
}

func (i *Interactor) attachScheduledWebPreview(row domain.ScheduledMessage, fl *previewFlight) {
	defer saferun.Recover("chat.attachScheduledWebPreview")
	defer i.previewFlights.drop(fl)
	b := i.buildWebPreview(fl.url, fl.key)
	if b == nil {
		return
	}
	withBudget(writeTimeout, func(ctx context.Context) {
		for {
			t := i.previewFlights.target(fl)
			if b.img != nil && !i.scheduledPreviewWanted(ctx, row.ID, t) {
				if i.previewFlights.settle(fl, t.gen) {
					log.Printf("webpreview: %s: карточка %s не нужна (отложенное правили, сняли или публикуют)", fl.key, previewHost(fl.url))
					return
				}
				continue
			}
			i.storePreviewPhoto(ctx, b, row.SenderID)
			wp := b.wp.Clone()
			derefChoice(t.choice).ApplySize(wp)
			written := false
			werr := i.writeScheduled(ctx, row.SenderID, func(ctx context.Context) ([]scheduledFrame, error) {
				ok, err := i.scheduled.SetWebPageIfSame(ctx, row.ID, wp, t.text, t.entities, t.choice)
				if err != nil || !ok {
					return nil, err
				}
				// Свежая строка: срок за время сборки могли перенести.
				cur, err := i.scheduled.ByID(ctx, row.ID)
				if err != nil {
					return nil, err
				}
				frames, _, err := i.scheduledNewFrames(ctx, []domain.ScheduledMessage{cur})
				written = err == nil
				return frames, err
			})
			if werr == nil && written {
				return
			}
			if werr != nil {
				log.Printf("webpreview: %s: карточка %s не записана: %v", fl.key, previewHost(fl.url), werr)
				return
			}
			if i.previewFlights.settle(fl, t.gen) {
				log.Printf("webpreview: %s: карточка %s не записана (условие записи: отложенное правили, сняли или публикуют)", fl.key, previewHost(fl.url))
				return
			}
		}
	})
}

// scheduledPreviewWanted — запись под цель t ещё может состояться (тот же
// текст, сущности и решение, карточки нет); до сохранения картинки к нам.
func (i *Interactor) scheduledPreviewWanted(ctx context.Context, id int64, t previewTarget) bool {
	cur, err := i.scheduled.ByID(ctx, id)
	if err != nil {
		if !errors.Is(err, domain.ErrNotFound) { // снятое/опубликованное — не сбой
			log.Printf("webpreview: s:%d: строка не прочитана: %v", id, err)
		}
		return false
	}
	return cur.WebPage == nil && cur.Text == t.text && entitiesEqual(cur.Entities, t.entities) &&
		reflect.DeepEqual(webPageInputPtr(derefChoice(cur.Params.WebPage)), webPageInputPtr(derefChoice(t.choice)))
}

// scheduledWebPageEdit — что правка отложенного делает с превью.
type scheduledWebPageEdit struct {
	choice        *domain.WebPageInput // решение после правки (снимок)
	choiceChanged bool                 // решение отличается от снимка
	next          *domain.WebPagePreview
	write         bool // записать next (правка текста или решения)
	rebuild       bool // после коммита собрать карточку заново
}

// scheduledEditWebPage — превью при правке отложенного, по тем же правилам,
// что у сообщения (updateTextWithWebPage/keptWebPage): ссылка та же —
// карточка остаётся (выбор размера — из media), ссылки нет или no_webpage —
// карточка снята, ссылка другая — снята и собирается заново.
func (i *Interactor) scheduledEditWebPage(m domain.ScheduledMessage, in EditScheduledInput, entities domain.MessageEntities, textChanged bool) scheduledWebPageEdit {
	e := scheduledWebPageEdit{choice: m.Params.WebPage, next: m.WebPage}
	// Отложенная пересылка несёт карточку источника, решения о превью у неё
	// нет (текст пересланного и не правится).
	if m.Type != "text" || m.Params.Fwd != nil {
		return e
	}
	// «Изменить время» у tweb — editMessage без полей превью и с прежним
	// текстом (contextMenu.ts:979-983): решение снимка он не трогает.
	if in.WebPage != nil && (textChanged || webPageInputPtr(*in.WebPage) != nil) {
		e.choice = webPageInputPtr(*in.WebPage)
		e.choiceChanged = !reflect.DeepEqual(e.choice, webPageInputPtr(derefChoice(m.Params.WebPage)))
	}
	if !textChanged && !e.choiceChanged {
		return e
	}
	choice := derefChoice(e.choice)
	url := previewURL(choice, in.Text, entities)
	// Решение по снимку, прочитанному до транзакции: карточку, которую тем
	// временем дописала догоняющая сборка, оно не видит, поэтому запись —
	// безусловная (иначе «ссылку убрали» оставило бы ту карточку навсегда).
	e.next, e.write = nil, true
	if m.WebPage != nil {
		e.next = keptWebPage(m.WebPage, url, choice)
	}
	e.rebuild = e.next == nil && url != "" && i.preview != nil
	return e
}

func derefChoice(c *domain.WebPageInput) domain.WebPageInput {
	if c == nil {
		return domain.WebPageInput{}
	}
	return *c
}

// applyScheduledEditWebPage — запись решения о превью и карточки правки в
// транзакции EditScheduled; row получает их для кадра правки.
func (i *Interactor) applyScheduledEditWebPage(ctx context.Context, row *domain.ScheduledMessage, e scheduledWebPageEdit) error {
	if e.choiceChanged {
		if err := i.scheduled.SetWebPageChoice(ctx, row.ID, e.choice); err != nil {
			return err
		}
		row.Params.WebPage = e.choice
	}
	if e.write {
		if err := i.scheduled.SetWebPage(ctx, row.ID, e.next); err != nil {
			return err
		}
		row.WebPage = e.next
	}
	return nil
}

// GetWebPage — карточка ссылки для плашки над полем ввода, до отправки
// (messages.getWebPage; плашка tweb зовёт именно его: input.ts:3594 →
// appWebPagesManager.ts:273-284). nil — карточки нет (клиент получит
// webPageEmpty и плашку не покажет, input.ts:3600).
//
// Собирается сама страница (og-теги): плашка показывает заголовок и
// описание (input.ts:3601-3605). Картинку к себе НЕ сохраняем: доступ к ней
// привязан к сообщению (messages.web_page_media_id, MediaAccessRepo), и до
// отправки её некому отдать, а сохранённая на каждую набранную ссылку она
// копила бы в хранилище мусор. Читаем только её размер — для has_large_media
// (выбор «крупнее/мельче» на плашке, input.ts:3619). Пробу Instant View не
// делаем — кнопка «Мгновенный просмотр» живёт на карточке в ленте, у плашки
// её нет. Карточку сообщения сервер строит сам при отправке
// (inputMediaWebPage несёт ссылку).
func (i *Interactor) GetWebPage(ctx context.Context, url string) *domain.WebPagePreview {
	url = strings.TrimSpace(url)
	if i.preview == nil || (!strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://")) {
		return nil
	}
	if wp, ok := i.webPages.get(url); ok {
		return plaqueCard(wp)
	}
	if !i.webPages.acquire(ctx) {
		return nil
	}
	defer i.webPages.release()
	// Без повтора: сбой плашки ничего не теряет — tweb перезапросит карточку
	// при следующей найденной ссылке (input.ts:3581-3594), а повтор держал бы
	// слот сборки и удваивал запросы к сайту на страницах без карточки.
	var once sync.Once
	done := func() { once.Do(i.webPages.startLoading(url)) }
	defer done() // и на панике разбора чужого HTML: ждущая сборка не повиснет
	pctx, cancel := context.WithTimeout(ctx, previewTimeout)
	wp, err := i.preview.Preview(pctx, url)
	cancel()
	if err != nil {
		wp = nil
	}
	// Страница — в кэш и ждущей сборке карточки сообщения СРАЗУ, до размера
	// картинки: has_large_media плашки сборке не нужен (его ставит сохранённая
	// картинка), и ждать заголовок с медленного CDN ей незачем. Оборванный
	// запрос и временный сбой «карточки нет» не запоминают.
	if ctx.Err() == nil && !errors.Is(err, ErrPreviewTransient) {
		i.webPages.put(url, wp, wp == nil) // «карточки нет» — сразу полная
	}
	done()
	if wp == nil {
		return nil
	}
	ectx, cancel := context.WithTimeout(ctx, enrichTimeout)
	wp.HasLargeMedia = i.previewHasLargeMedia(ectx, wp.ImageURL)
	cancel()
	// Достроенная — только если размер картинки действительно прочитан: на
	// оборванном запросе запись остаётся страницей для сборки, а следующая
	// плашка соберёт карточку заново.
	if ctx.Err() == nil {
		i.webPages.put(url, wp, true)
	}
	return plaqueCard(wp)
}

// plaqueCard — карточка плашки наружу: без адреса чужой картинки.
func plaqueCard(wp *domain.WebPagePreview) *domain.WebPagePreview {
	if wp != nil {
		wp.ImageURL = ""
	}
	return wp
}

// pageRetryDelay — пауза перед повтором загрузки страницы (var: тесты ужимают).
var pageRetryDelay = time.Second

// fetchPage — og-теги страницы для карточки сообщения (фоновая сборка).
// Временный сбой (ErrPreviewTransient: сеть, обрыв, 5xx) повторяется один
// раз — карточку сообщение иначе теряло бы навсегда. Таймаут исчерпывает весь
// бюджет этапа (previewTimeout), так что повтор срабатывает на быстрых
// отказах. Отказ по существу (не HTML, нет заголовка, 4xx, 429, запрещённый
// адрес) не повторяется.
func (i *Interactor) fetchPage(ctx context.Context, url, key string) *domain.WebPagePreview {
	for attempt := 0; ; attempt++ {
		p, err := i.preview.Preview(ctx, url)
		if err == nil && p != nil {
			return p
		}
		if attempt == 1 || !errors.Is(err, ErrPreviewTransient) {
			log.Printf("webpreview: %s: страница %s без карточки (попытка %d): %v", key, previewHost(url), attempt+1, err)
			return nil
		}
		select {
		case <-time.After(pageRetryDelay):
		case <-ctx.Done():
			log.Printf("webpreview: %s: страница %s: бюджет загрузки исчерпан: %v", key, previewHost(url), err)
			return nil
		}
	}
}

// previewHost — хост ссылки для логов (путь и параметры в лог не пишем).
func previewHost(raw string) string {
	if u, err := neturl.Parse(raw); err == nil && u.Host != "" {
		return u.Host
	}
	return "?"
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

// previewImage — картинка карточки, скачанная, но ещё не сохранённая.
type previewImage struct {
	data       []byte
	mime, name string
}

// downloadPreviewPhoto скачивает og:image (к нам её кладёт storePreviewPhoto).
// Так работает Telegram: браузер участника чата за картинкой превью на чужой
// хост не ходит и свой IP владельцу ссылки не сдаёт (а наш CSP
// `img-src 'self' data: blob:` внешний адрес и так режет).
//
// Best-effort ровно как остальная сборка превью: сайт отдал не картинку, не
// ответил, превысил лимит — карточка просто остаётся без фото. Транзитный
// wp.ImageURL гасим в любом случае: наружу он не уходит (`json:"-"`), но и в
// снимке ему делать нечего.
func (i *Interactor) downloadPreviewPhoto(ctx context.Context, wp *domain.WebPagePreview) *previewImage {
	defer func() { wp.ImageURL = "" }()
	if wp.ImageURL == "" || i.botHTTP == nil || i.botMedia == nil {
		return nil
	}
	data, mime, err := i.botHTTP.FetchURL(ctx, wp.ImageURL, maxPreviewPhoto)
	if err != nil || !strings.HasPrefix(mime, "image/") {
		return nil
	}
	// Имя файла — из пути ссылки: оно попадает в media.file_name и видно только
	// в отладке, но осмысленное лучше пустого.
	name := path.Base(wp.ImageURL)
	if u, e := neturl.Parse(wp.ImageURL); e == nil {
		name = path.Base(u.Path)
	}
	return &previewImage{data: data, mime: mime, name: name}
}

// storePreviewPhoto кладёт скачанную картинку к нам (владелец — ownerID) и
// подменяет её media_id в карточке; второй раз (повтор записи после
// перенацеливания) не сохраняет. has_large_media — только у сохранённой.
func (i *Interactor) storePreviewPhoto(ctx context.Context, b *builtPreview, ownerID int64) {
	if b.img == nil || b.wp.PhotoID != 0 {
		return
	}
	img := b.img
	b.img = nil
	if id, e := i.botMedia.Store(ctx, ownerID, img.mime, img.name, img.data); e == nil {
		// Размер — из заголовка сразу: обработка медиа асинхронная, и кадр
		// карточки (web_page_update, правка поста) уходит раньше, чем строка
		// media получит размеры. Без них ступени фото пришли бы без w/h, и
		// tweb нарисовал бы картинку квадратом до перезагрузки (bubbles.ts
		// :9592-9593: нет размера → is-square-photo).
		w, h := previewImageSize(img.data)
		b.wp.PhotoID, b.wp.PhotoW, b.wp.PhotoH = id, w, h
		b.wp.HasLargeMedia = largeSize(w, h)
	}
}

// Порог «крупной» картинки превью — коробка карточки tweb на десктопе:
// mediaSizes.active.webpage = 420×380 (helpers/mediaSizes.ts:85), на телефоне
// 340×200 (:67). Картинка не уже коробки и не ниже телефонной коробки заполнит
// её по ширине без растяжения.
const (
	largePreviewMinW = 420
	largePreviewMinH = 200
)

// largePreviewPhoto — правило has_large_media.
//
// ОСОЗНАННОЕ ОТСТУПЛЕНИЕ (решение пользователя 2026-10-11): как сервер
// Telegram решает «у превью крупное медиа», из tweb не видно — клиент только
// читает флаг (input.ts:3619, bubbles.ts:9479-9480). Наше правило: у карточки
// есть фото (видео в превью мы не разбираем) не меньше largePreviewMinW ×
// largePreviewMinH. Размер читается из заголовка файла: jpeg/png/gif —
// стандартной библиотекой, webp — webpSize.
func largePreviewPhoto(data []byte) bool {
	return largeSize(previewImageSize(data))
}

func largeSize(w, h int) bool { return w >= largePreviewMinW && h >= largePreviewMinH }

// previewImageSize — размер картинки из заголовка файла (0, 0 — не разобрать).
func previewImageSize(data []byte) (w, h int) {
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
		return cfg.Width, cfg.Height
	}
	if ww, hh, ok := webpSize(data); ok {
		return ww, hh
	}
	return 0, 0
}

// webpSize — размер картинки WebP из заголовка контейнера RIFF (спецификация
// WebP Container: чанки VP8 — с потерями, VP8L — без потерь, VP8X —
// расширенный, с размером холста).
func webpSize(b []byte) (w, h int, ok bool) {
	if len(b) < 30 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		return 0, 0, false
	}
	switch string(b[12:16]) {
	case "VP8 ": // кадр: 3 байта тега, старт-код 9d 01 2a, затем 14-битные ширина и высота
		if b[23] != 0x9d || b[24] != 0x01 || b[25] != 0x2a {
			return 0, 0, false
		}
		return int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff), int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff), true
	case "VP8L": // сигнатура 0x2f, затем 14 бит (ширина−1) и 14 бит (высота−1)
		if b[20] != 0x2f {
			return 0, 0, false
		}
		bits := binary.LittleEndian.Uint32(b[21:25])
		return int(bits&0x3fff) + 1, int((bits>>14)&0x3fff) + 1, true
	case "VP8X": // 4 байта флагов, затем 24 бита (ширина−1) и 24 бита (высота−1)
		u24 := func(p []byte) int { return int(p[0]) | int(p[1])<<8 | int(p[2])<<16 }
		return u24(b[24:27]) + 1, u24(b[27:30]) + 1, true
	}
	return 0, 0, false
}

// imageHeadBytes — сколько байт картинки читается ради её размера: заголовку
// jpeg/png/gif этого хватает с запасом (EXIF/ICC в начале jpeg бывают
// десятки килобайт).
const imageHeadBytes = 256 << 10

// previewHasLargeMedia — has_large_media для плашки композера (GetWebPage):
// картинку к нам не сохраняем и целиком не качаем — читаем только её
// заголовок тем же правилом, что и у карточки сообщения, иначе плашка не
// покажет «крупнее/мельче» (input.ts:3619).
func (i *Interactor) previewHasLargeMedia(ctx context.Context, imageURL string) bool {
	if imageURL == "" || i.botHTTP == nil {
		return false
	}
	data, mime, err := i.botHTTP.FetchPrefix(ctx, imageURL, imageHeadBytes)
	return err == nil && strings.HasPrefix(mime, "image/") && largePreviewPhoto(data)
}

// Кэш карточек плашки. tweb зовёт getWebPage на каждую новую найденную
// ссылку, пока её набирают (input.ts:3581-3594), и один адрес приходит
// много раз подряд — сайт и картинку второй раз не дёргаем. Ту же страницу
// берёт сборка карточки сообщения (buildWebPreview → page), картинку к нам она
// сохраняет сама. Ключ — адрес в разборе url.Parse (cacheKey): плашка tweb
// шлёт набранный адрес, а inputMediaWebPage — webPage.url, который отдал
// наш адаптер уже разобранным (appMessagesManager.ts:4872).
const (
	webPageCacheTTL = 10 * time.Minute
	webPageCacheMax = 2048
	// webPageFetchSlots — сколько сборок плашки идёт одновременно на сервер.
	webPageFetchSlots = 8
)

type webPageCacheEntry struct {
	wp      *domain.WebPagePreview // nil — карточки нет (тоже кэшируется)
	expires time.Time
	// complete — карточка плашки достроена (has_large_media посчитан).
	// Недостроенная — только страница для сборки: плашке она — промах.
	complete bool
}

// webPageCache — нулевое значение готово к работе.
type webPageCache struct {
	mu    sync.Mutex
	m     map[string]webPageCacheEntry
	slots chan struct{}
	// loading — идущие загрузки плашки по ключу (закрывается, как только
	// страница легла в кэш).
	loading map[string]chan struct{}
	// onWait — тестовый шов: сборка встала ждать загрузку плашки.
	onWait func()
}

// startLoading отмечает загрузку плашки key; возвращает функцию завершения.
func (c *webPageCache) startLoading(url string) func() {
	key := cacheKey(url)
	ch := make(chan struct{})
	c.mu.Lock()
	if c.loading == nil {
		c.loading = map[string]chan struct{}{}
	}
	c.loading[key] = ch
	c.mu.Unlock()
	return func() {
		c.mu.Lock()
		if c.loading[key] == ch {
			delete(c.loading, key)
		}
		c.mu.Unlock()
		close(ch)
	}
}

// cacheKey — адрес в разборе url.Parse (кириллица и пробелы — в
// процентной кодировке, как в webPage.url).
func cacheKey(raw string) string {
	if u, err := neturl.Parse(raw); err == nil {
		return u.String()
	}
	return raw
}

func (c *webPageCache) get(url string) (*domain.WebPagePreview, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[cacheKey(url)]
	if !ok || !e.complete || time.Now().After(e.expires) {
		return nil, false
	}
	return e.wp.Clone(), true
}

// pageEntry — запись для сборки карточки сообщения: и недостроенная.
func (c *webPageCache) pageEntry(url string) (*domain.WebPagePreview, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[cacheKey(url)]
	if !ok || time.Now().After(e.expires) {
		return nil, false
	}
	return e.wp.Clone(), true
}

// page — страница из кэша плашки для сборки карточки сообщения, без второго
// похода на сайт. НАШЕ серверное решение: tweb шлёт серверу только
// inputMediaWebPage{url, pFlags} (getInputMediaWebPage,
// appMessagesManager.ts:4865-4879), а карточку плашки кладёт лишь в своё
// оптимистичное сообщение (generateOutgoingWebPage :4895-4908); как сервер
// Telegram собирает карточку, из tweb не видно — у него страница кэшируется
// глобально по URL, у нас — в памяти процесса (допущение: один процесс
// бэкенда; при нескольких — промах и обычная загрузка). Страница, показанная
// плашкой, и уходит в сообщение — как у Telegram с его кэшем webpage; её
// возраст — до webPageCacheTTL, и временная страница (заглушка антибота с
// заголовком), пойманная плашкой, ляжет в снимок так же, как легла бы при
// своей загрузке в ту же минуту.
//
// Загрузка плашки того же адреса ещё идёт — ждём её (не больше ctx), а не
// грузим медленный сайт вторым запросом параллельно. Копия с адресом
// картинки и без has_large_media: флаг ставит сборка по картинке, которую
// сама сохранит. nil — страницы нет.
func (c *webPageCache) page(ctx context.Context, url string) *domain.WebPagePreview {
	c.mu.Lock()
	wait := c.loading[cacheKey(url)]
	onWait := c.onWait
	c.mu.Unlock()
	if wait != nil {
		if onWait != nil {
			onWait()
		}
		select {
		case <-wait:
		case <-ctx.Done():
			return nil
		}
	}
	wp, ok := c.pageEntry(url)
	if !ok || wp == nil {
		return nil
	}
	wp.HasLargeMedia = false
	return wp
}

func (c *webPageCache) put(url string, wp *domain.WebPagePreview, complete bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if c.m == nil {
		c.m = map[string]webPageCacheEntry{}
	}
	if len(c.m) >= webPageCacheMax {
		for k, e := range c.m {
			if now.After(e.expires) {
				delete(c.m, k)
			}
		}
		// Свежих не меньше потолка — вытесняем самую старую, а не весь кэш:
		// от него зависит и сборка карточек сообщений.
		for len(c.m) >= webPageCacheMax {
			oldest, at := "", time.Time{}
			for k, e := range c.m {
				if oldest == "" || e.expires.Before(at) {
					oldest, at = k, e.expires
				}
			}
			delete(c.m, oldest)
		}
	}
	c.m[cacheKey(url)] = webPageCacheEntry{wp: wp.Clone(), expires: now.Add(webPageCacheTTL), complete: complete}
}

// acquire занимает слот сборки; false — контекст кончился раньше.
func (c *webPageCache) acquire(ctx context.Context) bool {
	c.mu.Lock()
	if c.slots == nil {
		c.slots = make(chan struct{}, webPageFetchSlots)
	}
	slots := c.slots
	c.mu.Unlock()
	select {
	case slots <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

func (c *webPageCache) release() { <-c.slots }
