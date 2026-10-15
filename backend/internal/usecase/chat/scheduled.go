package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Отложенные сообщения (Telegram scheduled messages).
//
// У оригинала отложенное — ЛЮБАЯ отправка с `schedule_date` (tweb
// appMessagesManager.ts:2741 sendMessage, :3230 sendMedia, :3779
// sendMultiMedia, :4149 sendOther, :5652 forwardMessages). Поэтому постановка —
// ветка Send ПОСЛЕ всех его гейтов (enqueueScheduled), а строка очереди —
// полный снимок SendInput (domain.ScheduledParams). Публикация — тот же Send
// со снимком (fromSchedule: без медленного режима и без повторной платы, В-2).
//
// Кадры (схемные updateNewScheduledMessage / updateDeleteScheduledMessages,
// tweb appMessagesManager.ts:811-813, :11773-11815) идут только автору — его
// пер-юзерным журналом, в той же транзакции, что и мутация строки; живьём —
// после коммита. Так второе устройство видит постановку, правку и снятие, а
// /sync их переигрывает.

// maxScheduledPerChat — лимит очереди автора в одном чате (Telegram
// SCHEDULE_TOO_MUCH; tweb лимита не знает и ошибку отдельно не обрабатывает).
const maxScheduledPerChat = 100

// Типы записей журнала (конверт `t`): тело — схемный конструктор.
const (
	scheduledNewFrame    = "scheduled_new"
	scheduledDeleteFrame = "scheduled_delete"
)

// scheduledRowOf — снимок SendInput строкой очереди: колонки — то, что
// колонки и у строки messages, остальное — jsonb params. Обратная сборка —
// sendInputOf; тест-скан сверяет, что новое публичное поле SendInput не
// теряется у отложенного. Срок (send_at/when_online) ставит вызывающий.
func scheduledRowOf(in SendInput) domain.ScheduledMessage {
	row := domain.ScheduledMessage{
		ChatID: in.ChatID, SenderID: in.SenderID, Type: in.Type, Text: in.Text, Entities: in.Entities,
		ReplyToID: in.ReplyToID, MediaID: in.MediaID, RepeatPeriod: in.ScheduleRepeatPeriod,
		Params: scheduledParamsOf(in),
	}
	if in.ClientMsgID != "" {
		cmid := in.ClientMsgID
		row.ClientMsgID = &cmid
	}
	return row
}

func scheduledParamsOf(in SendInput) domain.ScheduledParams {
	p := domain.ScheduledParams{
		ReplyToPeerID: in.ReplyToPeerID, ReplyQuoteText: in.ReplyQuoteText, ReplyQuoteOffset: in.ReplyQuoteOffset,
		ThreadRootID: in.ThreadRootID, GroupedID: in.GroupedID,
		PollID: in.PollID, ChecklistID: in.ChecklistID,
		GeoLat: in.GeoLat, GeoLng: in.GeoLng, GeoTitle: in.GeoTitle, GeoAddress: in.GeoAddress,
		GeoLivePeriod: in.GeoLivePeriod, GeoHeading: in.GeoHeading,
		ContactUserID: in.contactUserID,
		Silent:        in.Silent, Effect: in.Effect, PaidMediaPrice: in.PaidMediaPrice,
		MediaSpoiler: in.MediaSpoiler, SendAsChatID: in.SendAsChatID,
		WebPage: webPageInputPtr(in.WebPage),
	}
	p.ContactName, p.ContactLastName, p.ContactPhone, p.ContactVcard = in.contactFields()
	// Согласие на плату переживает постановку: повторы платят по нему. Вход без
	// согласия по TL (nil) повторы публикует без проверки, как строки до деплоя.
	if !in.paidConsentNotRequired {
		allow := in.AllowPaidStars
		p.AllowPaidStars = &allow
	}
	return p
}

// webPageInputPtr — решение о превью в снимок, нормализованное: ложные
// pFlags отброшены (как и при JSON-круге снимка), нулевое не хранится.
func webPageInputPtr(w domain.WebPageInput) *domain.WebPageInput {
	w = w.Normalized()
	if w == (domain.WebPageInput{}) {
		return nil
	}
	return &w
}

// sendInputOf — отправка, которую публикует строка очереди.
func sendInputOf(m domain.ScheduledMessage) SendInput {
	p := m.Params
	in := SendInput{
		ChatID: m.ChatID, SenderID: m.SenderID, Type: m.Type, Text: m.Text, Entities: m.Entities,
		ReplyToID: m.ReplyToID, MediaID: m.MediaID,
		ReplyToPeerID: p.ReplyToPeerID, ReplyQuoteText: p.ReplyQuoteText, ReplyQuoteOffset: p.ReplyQuoteOffset,
		ThreadRootID: p.ThreadRootID, GroupedID: p.GroupedID,
		PollID: p.PollID, ChecklistID: p.ChecklistID,
		GeoLat: p.GeoLat, GeoLng: p.GeoLng, GeoTitle: p.GeoTitle, GeoAddress: p.GeoAddress,
		GeoLivePeriod: p.GeoLivePeriod, GeoHeading: p.GeoHeading,
		Silent: p.Silent, Effect: p.Effect, PaidMediaPrice: p.PaidMediaPrice,
		MediaSpoiler: p.MediaSpoiler, SendAsChatID: p.SendAsChatID,
		ScheduleRepeatPeriod: m.RepeatPeriod,
	}
	in.Contact = p.ContactInput()
	if p.AllowPaidStars != nil {
		in.AllowPaidStars = *p.AllowPaidStars
	} else {
		in.paidConsentNotRequired = true // строка до деплоя: платит как раньше
	}
	if p.WebPage != nil {
		in.WebPage = *p.WebPage
	}
	if m.ClientMsgID != nil {
		in.ClientMsgID = *m.ClientMsgID
	}
	return in
}

// scheduleTiming — дата и повтор постановки или правки. SendWhenOnlineTimestamp
// — «когда будет в сети» (повтора у него нет: tweb шлёт его без периода,
// scheduleSendingPopup.tsx:80); иначе дата строго в будущем (tweb сам
// отправляет обычной отправкой дату ≤ now+10 с, input.ts:2163-2168, поэтому
// отказ — для самодельного запроса). Период — только из набора tweb.
//
// ОТСТУПЛЕНИЕ (решение пользователя 2026-10-10): у tweb ряд «Повтор» доступен
// только с Premium (scheduleSendingPopup.tsx:110-123, rootScope.premium); у
// нас повтор без Premium — гейта нет ни здесь, ни у клиента.
func (i *Interactor) scheduleTiming(ctx context.Context, chatID, senderID, date int64, repeat int) (time.Time, bool, int, error) {
	if !domain.ValidScheduleRepeatPeriod(repeat) {
		return time.Time{}, false, 0, domain.ErrInvalid
	}
	if date == domain.SendWhenOnlineTimestamp {
		if err := i.checkSendWhenOnline(ctx, chatID, senderID); err != nil {
			return time.Time{}, false, 0, err
		}
		// send_at при when_online не используется; момент постановки — чтобы
		// у строки был устойчивый ключ публикации (см. publishScheduledRow).
		return time.Now(), true, 0, nil
	}
	at := time.Unix(date, 0)
	if !at.After(time.Now()) {
		return time.Time{}, false, 0, domain.ErrInvalid
	}
	return at, false, repeat, nil
}

// checkSendWhenOnline — «отправить, когда будет в сети» доступно только в
// личке и только когда «был(а) в сети» собеседника отправителю видно (tweb
// canSendWhenOnline → isUserOnlineVisible, input.ts:2149-2161). Серверный
// гейт — сверх tweb (В-8: оставлен от самодельного запроса).
func (i *Interactor) checkSendWhenOnline(ctx context.Context, chatID, senderID int64) error {
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return err
	}
	if typ != domain.ChatTypePrivate {
		return domain.ErrForbidden
	}
	if i.privacy == nil {
		return nil
	}
	peer := i.privatePeer(ctx, chatID, senderID)
	if peer == 0 {
		return domain.ErrForbidden
	}
	visible, err := i.privacy.Check(ctx, peer, senderID, domain.PrivacyLastSeen)
	if err != nil {
		return err
	}
	if !visible {
		return domain.ErrForbidden
	}
	return nil
}

// enqueueScheduled — ветка Send для отправки с ScheduleDate: все гейты Send уже
// пройдены. Вместо вставки, веера, пуша, превью и зеркала — строка очереди и
// кадр updateNewScheduledMessage автору; плата за сообщение списывается
// сейчас (В-2), черновик снимается, как обычной отправкой (tweb шлёт
// clear_draft в том же запросе, appMessagesManager.ts:2740).
//
// Возвращает отложенное в форме строки messages: Seq — ключ отложенного
// (domain.ScheduledMessage.Message), ID — ноль.
func (i *Interactor) enqueueScheduled(ctx context.Context, in SendInput) (domain.Message, error) {
	if i.scheduled == nil {
		return domain.Message{}, domain.ErrInvalid
	}
	// Отложить можно только то, что отправляет сам пользователь: служебки,
	// подарок, розыгрыш, клавиатура бота и секретный чат в снимок не входят.
	if in.Action != nil || in.prepare != nil || in.Type == "encrypted" || len(in.EncBody) > 0 ||
		in.TTLSeconds != nil || in.GiftID != nil || in.GiveawayID != nil || in.ReplyMarkup != nil {
		return domain.Message{}, domain.ErrInvalid
	}
	// Повтор кадра уже принятой постановки (переподключение) отдаёт её строку
	// до проверки срока: к повтору срок мог и пройти.
	if in.ClientMsgID != "" {
		if ex, e := i.scheduled.ByClientMsgID(ctx, in.ChatID, in.SenderID, in.ClientMsgID); e == nil {
			return ex.Message(), nil
		} else if !errors.Is(e, domain.ErrNotFound) {
			return domain.Message{}, e
		}
	}
	sendAt, whenOnline, repeat, err := i.scheduleTiming(ctx, in.ChatID, in.SenderID, in.ScheduleDate, in.ScheduleRepeatPeriod)
	if err != nil {
		return domain.Message{}, err
	}
	if err := i.checkEnqueueSlowmode(ctx, in, sendAt, whenOnline); err != nil {
		return domain.Message{}, err
	}
	row := scheduledRowOf(in)
	row.SendAt, row.WhenOnline, row.RepeatPeriod = sendAt, whenOnline, repeat
	stored, created, err := i.putScheduled(ctx, in.ChatID, in.SenderID, []domain.ScheduledMessage{row}, []SendInput{in})
	if err != nil {
		return domain.Message{}, err
	}
	if created {
		i.clearDraftAfterSend(ctx, in.SenderID, in.ChatID, in.ThreadRootID, in.ReplyToID)
		i.startScheduledWebPreview(stored[0])
	}
	return stored[0].Message(), nil
}

// checkEnqueueSlowmode — медленный режим ВНУТРИ очереди при постановке
// сообщения. Элементы одного альбома на тот же срок — одна единица, пока
// альбом не больше maxAlbumSize (как у обычной отправки, checkSendAllowed):
// иначе общий grouped_id ставил бы сколько угодно медиа на одну минуту.
func (i *Interactor) checkEnqueueSlowmode(ctx context.Context, in SendInput, sendAt time.Time, whenOnline bool) error {
	var album func(domain.ScheduledMessage) bool
	if in.GroupedID != 0 && in.MediaID != nil && !whenOnline {
		rows, err := i.scheduled.ByGroupedID(ctx, in.ChatID, in.SenderID, in.GroupedID)
		if err != nil {
			return err
		}
		if len(rows) < maxAlbumSize {
			album = func(r domain.ScheduledMessage) bool {
				return r.Params.GroupedID == in.GroupedID && !r.WhenOnline && r.SendAt.Equal(sendAt)
			}
		}
	}
	return i.checkScheduledSlowmode(ctx, in.ChatID, in.SenderID, sendAt, whenOnline, album)
}

// checkScheduledSlowmode — медленный режим ВНУТРИ очереди: публикация
// отложенного его не проходит (В-2), поэтому постановка, пересылка и перенос
// срока обязаны держать интервал между отложенными автора в чате — иначе сто
// постановок на одну минуту обходили бы режим. unit — строки той же единицы
// (альбом, сама правимая строка): они интервалу не мешают. Сбой чтения —
// отказ, а не пропуск (как ограничения в checkSendAllowed).
func (i *Interactor) checkScheduledSlowmode(ctx context.Context, chatID, senderID int64, sendAt time.Time,
	whenOnline bool, unit func(domain.ScheduledMessage) bool) error {
	if i.groups == nil || whenOnline {
		return nil
	}
	m, err := i.groups.GetMember(ctx, chatID, senderID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil // не группа (личка): медленного режима нет
	}
	if err != nil {
		return err
	}
	if m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin {
		return nil
	}
	st, err := i.groups.Settings(ctx, chatID)
	if err != nil {
		return err
	}
	if st.SlowmodeSeconds <= 0 {
		return nil
	}
	rows, err := i.scheduled.ListByChat(ctx, chatID, senderID)
	if err != nil {
		return err
	}
	window := time.Duration(st.SlowmodeSeconds) * time.Second
	for _, r := range rows {
		if r.WhenOnline || (unit != nil && unit(r)) {
			continue
		}
		if d := r.SendAt.Sub(sendAt); d < window && d > -window {
			return domain.ErrSlowmode
		}
	}
	return nil
}

// scheduleForward — отложенная пересылка (tweb forwardMessages{schedule_date},
// appMessagesManager.ts:5652): гейты пересылки пройдены, копии сняты
// copyContent с атрибуцией. Каждая копия — строка очереди со снимком
// пересылки (ScheduledParams.Fwd); публикация вставит копию тем же
// deliverForwardCopies, что и обычная пересылка.
func (i *Interactor) scheduleForward(ctx context.Context, in ForwardInput, srcIDs []int64,
	copies []domain.Message, offers map[int64]PaidOffer) ([]domain.Message, error) {
	if i.scheduled == nil {
		return nil, domain.ErrInvalid
	}
	sendAt, whenOnline, repeat, err := i.scheduleTiming(ctx, in.ToChatID, in.SenderID, in.ScheduleDate, in.ScheduleRepeatPeriod)
	if err != nil {
		return nil, err
	}
	// Пачка в медленном режиме уже отвергнута checkForwardAllowed
	// (batchUnits); одна копия — одна единица очереди.
	if err := i.checkScheduledSlowmode(ctx, in.ToChatID, in.SenderID, sendAt, whenOnline, nil); err != nil {
		return nil, err
	}
	rows := make([]domain.ScheduledMessage, len(copies))
	probes := make([]SendInput, len(copies))
	for idx, c := range copies {
		fwd := &domain.ScheduledFwd{
			SrcMsgID:   srcIDs[idx],
			FromUserID: c.FwdFromUserID, FromChatID: c.FwdFromChatID, FromMsgID: c.FwdFromMsgID,
			FromName: c.FwdFromName, GiveawayID: c.GiveawayID,
		}
		if c.FwdDate != nil {
			d := c.FwdDate.Unix()
			fwd.Date = &d
		}
		if c.ReplyMarkup != nil {
			if raw, e := json.Marshal(c.ReplyMarkup); e == nil {
				fwd.ReplyMarkup = raw
			}
		}
		if o, ok := offers[srcIDs[idx]]; ok {
			fwd.OfferPrice, fwd.OfferID = o.Price, o.OfferID
		}
		p := domain.ScheduledParams{
			ThreadRootID: in.ThreadRootID, PollID: c.PollID, ChecklistID: c.ChecklistID,
			GeoLat: c.GeoLat, GeoLng: c.GeoLng, GeoTitle: c.GeoTitle, GeoAddress: c.GeoAddress,
			ContactUserID: c.ContactUserID, ContactName: c.ContactName, ContactLastName: c.ContactLastName,
			ContactPhone: c.ContactPhone, ContactVcard: c.ContactVcard,
			Silent: in.Silent, MediaSpoiler: c.MediaSpoiler, Fwd: fwd,
		}
		if c.GroupedID != nil {
			p.GroupedID = *c.GroupedID
		}
		// Согласие пачки делится на сообщения: повтор строки платит за одно.
		if !in.paidConsentNotRequired {
			allow := in.AllowPaidStars / int64(len(copies))
			p.AllowPaidStars = &allow
		}
		rows[idx] = domain.ScheduledMessage{
			ChatID: in.ToChatID, SenderID: in.SenderID, Type: c.Type, Text: c.Text, Entities: c.Entities,
			MediaID: c.MediaID, SendAt: sendAt, WhenOnline: whenOnline, RepeatPeriod: repeat,
			Params: p, WebPage: c.WebPage,
		}
		probes[idx] = sendProbe(in.ToChatID, in.SenderID, c)
		probes[idx].AllowPaidStars, probes[idx].paidConsentNotRequired = in.AllowPaidStars, in.paidConsentNotRequired
	}
	stored, _, err := i.putScheduled(ctx, in.ToChatID, in.SenderID, rows, probes)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Message, len(stored))
	for idx, sm := range stored {
		out[idx] = sm.Message()
	}
	return out, nil
}

// putScheduled — постановка пачки строк одной транзакцией: повтор по
// client_msg_id отдаёт уже стоящую строку (без платы и кадров, created=false);
// новые проходят лимит очереди чата, плату за каждое сообщение (probes — по
// пробе отправки на строку) и встают с кадрами updateNewScheduledMessage в
// журнал автора. После коммита — живые кадры и балансы звёзд.
//
// Лимит и плата — ДО вставки: отказ не должен зависеть от отката транзакции.
func (i *Interactor) putScheduled(ctx context.Context, chatID, senderID int64,
	rows []domain.ScheduledMessage, probes []SendInput) ([]domain.ScheduledMessage, bool, error) {
	stored, created, err := i.putScheduledOnce(ctx, chatID, senderID, rows, probes)
	if errors.Is(err, errScheduledRaced) {
		// Параллельная постановка того же client_msg_id успела раньше: повтор
		// находит её строку сразу.
		return i.putScheduledOnce(ctx, chatID, senderID, rows, probes)
	}
	return stored, created, err
}

func (i *Interactor) putScheduledOnce(ctx context.Context, chatID, senderID int64,
	rows []domain.ScheduledMessage, probes []SendInput) ([]domain.ScheduledMessage, bool, error) {
	var stored []domain.ScheduledMessage
	var frames []scheduledFrame
	var charge paidCharge
	created := false
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		stored, frames, charge, created = make([]domain.ScheduledMessage, len(rows)), nil, paidCharge{}, false
		var fresh []int
		for idx, row := range rows {
			if row.ClientMsgID != nil {
				ex, e := i.scheduled.ByClientMsgID(ctx, row.ChatID, row.SenderID, *row.ClientMsgID)
				if e == nil {
					stored[idx] = ex
					continue
				}
				if !errors.Is(e, domain.ErrNotFound) {
					return e
				}
			}
			fresh = append(fresh, idx)
		}
		if len(fresh) == 0 {
			return nil
		}
		// Блокировка очереди: параллельные постановки иначе проходили бы
		// лимит вместе (счёт и вставка — без гонки).
		if e := i.scheduled.LockQueue(ctx, chatID, senderID); e != nil {
			return e
		}
		n, e := i.scheduled.CountByChat(ctx, chatID, senderID)
		if e != nil {
			return e
		}
		if n+len(fresh) > maxScheduledPerChat {
			return domain.ErrScheduleTooMuch
		}
		// Согласие на плату — на все новые строки сразу, до первого списания:
		// у одиночной отправки allow — её сумма, у пересылки — сумма пачки.
		price, e := i.paidPriceFor(ctx, probes[fresh[0]], len(fresh))
		if e != nil {
			return e
		}
		// Плата за все новые строки — одним списанием; на каждой строке остаётся
		// её доля (цена одного сообщения): отвергнутая публикация вернёт её.
		ch, e := i.chargePaidMessage(ctx, chatID, senderID, price*int64(len(fresh)))
		if e != nil {
			return e
		}
		charge = ch
		news := make([]domain.ScheduledMessage, 0, len(fresh))
		for _, idx := range fresh {
			if ch.applied {
				rows[idx].PaidStars, rows[idx].PaidTo = price, ch.creatorID
			}
			// Превью у строки бывает только снимком копии (пересылка); пишется
			// отдельным UPDATE, как у сообщения (insertCopy).
			wp := rows[idx].WebPage
			sm, ok, e := i.scheduled.Create(ctx, rows[idx])
			if e != nil {
				return e
			}
			if !ok {
				return errScheduledRaced // откат платы; см. putScheduled
			}
			if wp != nil {
				if e := i.scheduled.SetWebPage(ctx, sm.ID, wp); e != nil {
					return e
				}
				sm.WebPage = wp
			}
			stored[idx] = sm
			news = append(news, sm)
		}
		created = true
		f, _, e := i.scheduledNewFrames(ctx, news)
		if e != nil {
			return e
		}
		frames = f
		return i.logScheduledFrames(ctx, senderID, frames)
	})
	if err != nil {
		return nil, false, err
	}
	if charge.applied {
		i.publishBalance(ctx, senderID, charge.senderBal)
		if charge.creatorID != 0 {
			i.publishBalance(ctx, charge.creatorID, charge.creatorBal)
		}
	}
	i.publishScheduledFrames(ctx, senderID, frames)
	return stored, created, nil
}

// errScheduledRaced — гонка двух постановок одного client_msg_id: транзакция
// проигравшей откатывается и повторяется (тогда строка находится сразу).
var errScheduledRaced = errors.New("scheduled: concurrent duplicate")

// ── Кадры ───────────────────────────────────────────────────────────────────

// scheduledFrame — запись журнала отложенных: тип конверта, тело (схемный
// конструктор) и курсор, полученный при записи.
type scheduledFrame struct {
	typ  string
	body map[string]any
	pts  int64
}

// updateBody — конструктор Update словарём (тело журнала и кадра). UseNumber —
// чтобы большой id не уехал округлённым через float64.
func updateBody(u domain.Update) (map[string]any, error) {
	raw, err := json.Marshal(u)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var out map[string]any
	if err := dec.Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// scheduledNewFrames — updateNewScheduledMessage на каждую строку (глазами
// автора: отложенные видит только он): записи журнала и те же апдейты для
// ответа ручки.
func (i *Interactor) scheduledNewFrames(ctx context.Context, rows []domain.ScheduledMessage) ([]scheduledFrame, []domain.Update, error) {
	if len(rows) == 0 {
		return nil, nil, nil
	}
	wire, err := i.scheduledWire(ctx, rows[0].SenderID, rows)
	if err != nil {
		return nil, nil, err
	}
	frames := make([]scheduledFrame, 0, len(wire))
	updates := make([]domain.Update, 0, len(wire))
	for _, w := range wire {
		u := domain.NewUpdateNewScheduledMessage(w)
		body, err := updateBody(u)
		if err != nil {
			return nil, nil, err
		}
		frames = append(frames, scheduledFrame{typ: scheduledNewFrame, body: body})
		updates = append(updates, u)
	}
	return frames, updates, nil
}

// scheduledDeleteUpdate — updateDeleteScheduledMessages глазами автора.
func (i *Interactor) scheduledDeleteUpdate(ctx context.Context, chatID, userID int64, ids, sent []int64) (domain.UpdateDeleteScheduledMessages, error) {
	peer, err := i.ChatIDToPeer(ctx, userID, chatID)
	if err != nil {
		return domain.UpdateDeleteScheduledMessages{}, err
	}
	return domain.NewUpdateDeleteScheduledMessages(domain.NewPeer(peer), ids, sent), nil
}

// logScheduledFrames пишет кадры в журнал автора В ТЕКУЩЕЙ транзакции (рядом
// с мутацией строк) и запоминает курсоры. Без журнала — no-op, как у
// logAndPublish.
func (i *Interactor) logScheduledFrames(ctx context.Context, userID int64, frames []scheduledFrame) error {
	if i.updates == nil {
		return nil
	}
	date := nowUnix()
	for k := range frames {
		payload, err := json.Marshal(frames[k].body)
		if err != nil {
			return err
		}
		pts, err := i.updates.AppendUpdate(ctx, userID, 1, date, frames[k].typ, payload)
		if err != nil {
			return err
		}
		frames[k].pts = pts
	}
	return nil
}

// publishScheduledFrames — живые кадры на все устройства автора после коммита.
func (i *Interactor) publishScheduledFrames(ctx context.Context, userID int64, frames []scheduledFrame) {
	if i.publisher == nil || i.updates == nil {
		return
	}
	for _, f := range frames {
		_ = i.publisher.PublishToUser(ctx, userID, framePts(f.typ, f.body, f.pts))
	}
}

// writeScheduled — мутация строк очереди и её кадры одной транзакцией, живые
// кадры — после коммита. mutate возвращает кадры, которые надо записать.
// Общая точка для правки, снятия, публикации и превью отложенного (P1:
// SetWebPage + scheduledNewFrames).
func (i *Interactor) writeScheduled(ctx context.Context, userID int64,
	mutate func(ctx context.Context) ([]scheduledFrame, error)) error {
	var frames []scheduledFrame
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		f, e := mutate(ctx)
		if e != nil {
			return e
		}
		frames = f
		return i.logScheduledFrames(ctx, userID, frames)
	})
	if err != nil {
		return err
	}
	i.publishScheduledFrames(ctx, userID, frames)
	return nil
}

// ── Отдача ──────────────────────────────────────────────────────────────────

// scheduledWire — отложенные тем же конструктором `message`, что и
// отправленные (общая сборка Message.ToWire): медиа (НО-1), опрос, чек-лист,
// розыгрыш, номер корня треда (reply_to_top_id), ссылки на пиры (fwd_from,
// reply_to_peer_id), send-as (from_id). Сверху — признаки отложенного
// (ScheduledMessage.ToWire). Зритель — автор: чужие отложенные не отдаются.
func (i *Interactor) scheduledWire(ctx context.Context, viewerID int64, rows []domain.ScheduledMessage) ([]domain.MessageReal, error) {
	if len(rows) == 0 {
		return nil, nil
	}
	msgs := make([]domain.Message, len(rows))
	for k, r := range rows {
		msgs[k] = r.Message()
	}
	if err := i.hydrateMedia(ctx, msgs); err != nil {
		return nil, err
	}
	_ = i.hydratePolls(ctx, viewerID, msgs)
	i.hydrateChecklists(ctx, msgs)
	i.hydrateGiveaways(ctx, viewerID, msgs)
	ext, err := i.ExternalizeThreadRoots(ctx, msgs)
	if err != nil {
		return nil, err
	}
	ext = i.HydrateMessagePeers(ctx, ext)
	kinds := i.chatKinds(ctx, ext)
	shown := i.postAuthorsShown(ctx, kinds)
	out := make([]domain.MessageReal, 0, len(ext))
	for k, m := range ext {
		peer, err := i.ChatIDToPeer(ctx, viewerID, m.ChatID)
		if err != nil {
			return nil, err
		}
		w, ok := m.ToWire(domain.MessageContext{
			Peer: domain.NewPeer(peer), Post: kinds[m.ChatID] == domain.ChatTypeChannel,
			PostAuthorShown: shown[m.ChatID], Out: true,
		}).(domain.MessageReal)
		if !ok {
			return nil, fmt.Errorf("scheduled %d: not a message", rows[k].ID)
		}
		out = append(out, rows[k].ToWire(w))
	}
	return out, nil
}

// ListScheduled — лента отложенных автора в чате (messages.getScheduledHistory).
// Писать в чат нельзя — лента пуста (tweb getScheduledMessages: canSendToPeer,
// appMessagesManager.ts:12395).
func (i *Interactor) ListScheduled(ctx context.Context, chatID, userID int64) ([]domain.MessageReal, error) {
	if i.scheduled == nil {
		return nil, nil
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrNotFound
	}
	if !i.canSendScheduled(ctx, chatID, userID) {
		return nil, nil
	}
	rows, err := i.scheduled.ListByChat(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	return i.scheduledWire(ctx, userID, rows)
}

// canSendScheduled — может ли участник писать в чат (канал — право постинга,
// группа — права чата и личное ограничение без медленного режима).
func (i *Interactor) canSendScheduled(ctx context.Context, chatID, userID int64) bool {
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return false
	}
	if typ == domain.ChatTypeChannel {
		return i.requireRight(ctx, chatID, userID, domain.RightPostMessages) == nil
	}
	return i.checkSendAllowed(ctx, SendInput{ChatID: chatID, SenderID: userID, fromSchedule: true}) == nil
}

// ScheduledUpdates — updateNewScheduledMessage по ключам отложенных автора:
// ответ ручки отправки с schedule_date (контейнер updates, как у оригинала).
func (i *Interactor) ScheduledUpdates(ctx context.Context, chatID, userID int64, ids []int64) ([]domain.Update, error) {
	if i.scheduled == nil {
		return nil, domain.ErrNotFound
	}
	rows, err := i.scheduled.ByIDs(ctx, chatID, userID, ids)
	if err != nil {
		return nil, err
	}
	wire, err := i.scheduledWire(ctx, userID, rows)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Update, len(wire))
	for k, w := range wire {
		out[k] = domain.NewUpdateNewScheduledMessage(w)
	}
	return out, nil
}

// ── Правка ──────────────────────────────────────────────────────────────────

// EditScheduledInput — правка отложенного (messages.editMessage с
// schedule_date, tweb appMessagesManager.ts:2207-2222).
type EditScheduledInput struct {
	ChatID, ID, UserID int64
	Text               string
	Entities           domain.MessageEntities
	ScheduleDate       int64
	// ScheduleRepeatPeriod — nil: повтор не меняется. tweb шлёт период только
	// там, где его выбирали (contextMenu.ts:981, «Изменить время»); правка
	// текста из поля ввода его не несёт, и снимать повтор она не должна.
	ScheduleRepeatPeriod *int
	// WebPage — решение о превью (no_webpage, invert_media, inputMediaWebPage):
	// tweb шлёт их в messages.editMessage и с schedule_date
	// (appMessagesManager.ts:2207-2220). nil — не передано, решение снимка не
	// меняется (внутренние вызовы).
	WebPage *domain.WebPageInput
}

// EditScheduled правит своё отложенное: текст и разметку, время, переход в
// «когда будет в сети» и обратно (НО-3), повтор. Время альбома переносится
// целиком — альбом публикуется одной единицей. Ответ и кадр —
// updateNewScheduledMessage с тем же id (tweb :11787-11794 — правка).
// Ошибки — те, что tweb обрабатывает (:2226-2240): MESSAGE_NOT_MODIFIED и
// MESSAGE_EMPTY.
func (i *Interactor) EditScheduled(ctx context.Context, in EditScheduledInput) ([]domain.Update, error) {
	if i.scheduled == nil {
		return nil, domain.ErrNotFound
	}
	m, err := i.scheduled.ByID(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if m.ChatID != in.ChatID || m.SenderID != in.UserID {
		return nil, domain.ErrNotFound
	}
	if utf8.RuneCountInString(in.Text) > maxMessageRunes {
		return nil, domain.ErrTooLong
	}
	entities := domain.SanitizeEntities(in.Entities)
	if in.Text == "" && m.MediaID == nil && m.Params.PollID == nil && m.Params.ChecklistID == nil &&
		m.Params.GeoLat == nil && m.Params.ContactName == nil {
		return nil, domain.ErrMessageEmpty
	}
	textChanged := in.Text != m.Text || !entitiesEqual(entities, m.Entities)
	if textChanged && m.Params.Fwd != nil {
		return nil, domain.ErrForbidden // текст пересланного не правится
	}
	wantRepeat := m.RepeatPeriod
	if in.ScheduleRepeatPeriod != nil {
		wantRepeat = *in.ScheduleRepeatPeriod
	}
	sendAt, whenOnline, repeat, err := i.scheduleTiming(ctx, m.ChatID, m.SenderID, in.ScheduleDate, wantRepeat)
	if err != nil {
		return nil, err
	}
	timeChanged := whenOnline != m.WhenOnline || (!whenOnline && !sendAt.Equal(m.SendAt)) || repeat != m.RepeatPeriod
	wp := i.scheduledEditWebPage(m, in, entities, textChanged)
	if !textChanged && !timeChanged && !wp.choiceChanged {
		return nil, domain.ErrMessageNotModified
	}
	group := []domain.ScheduledMessage{m}
	if g := m.Params.GroupedID; g != 0 && timeChanged {
		if group, err = i.scheduled.ByGroupedID(ctx, m.ChatID, m.SenderID, g); err != nil {
			return nil, err
		}
	}
	if timeChanged {
		// Строка, чьё сообщение уже вставлено по прежнему сроку (сбой между
		// публикацией и снятием), не переносится: новый срок дал бы новый
		// ключ публикации — второе сообщение или возврат звёзд за
		// доставленное. Её снимет воркер с sent_messages.
		for _, r := range group {
			if _, e := i.msgs.FindByClientMsgID(ctx, r.ChatID, r.SenderID, publishKey(r)); e == nil {
				return nil, domain.ErrNotFound
			} else if !errors.Is(e, domain.ErrNotFound) {
				return nil, e
			}
		}
		// Перенос срока держит интервал медленного режима, как постановка;
		// сама строка и её альбом — одна единица.
		ids := make(map[int64]bool, len(group))
		for _, r := range group {
			ids[r.ID] = true
		}
		if err := i.checkScheduledSlowmode(ctx, m.ChatID, m.SenderID, sendAt, whenOnline,
			func(r domain.ScheduledMessage) bool { return ids[r.ID] }); err != nil {
			return nil, err
		}
	}
	var out []domain.Update
	err = i.writeScheduled(ctx, m.SenderID, func(ctx context.Context) ([]scheduledFrame, error) {
		edited := make([]domain.ScheduledMessage, 0, len(group))
		for _, row := range group {
			// Условие — прочитанный срок: строку, которую тем временем
			// опубликовали и переставили (повтор), правка не откатывает.
			oldAt, oldWO := row.SendAt, row.WhenOnline
			if row.ID == m.ID {
				row.Text, row.Entities = in.Text, entities
			}
			if timeChanged {
				row.SendAt, row.WhenOnline, row.RepeatPeriod = sendAt, whenOnline, repeat
			}
			if e := i.scheduled.Update(ctx, row, oldAt, oldWO); e != nil {
				return nil, e
			}
			if row.ID == m.ID {
				if e := i.applyScheduledEditWebPage(ctx, &row, wp); e != nil {
					return nil, e
				}
				m = row
			}
			edited = append(edited, row)
		}
		frames, updates, e := i.scheduledNewFrames(ctx, edited)
		out = updates
		return frames, e
	})
	if err != nil {
		return nil, err
	}
	// Карточки нет, а ссылка есть (её сменили или добавили) — догоняющая
	// сборка, как у правки сообщения (rebuildWebPreviewOnEdit).
	if wp.rebuild {
		i.startScheduledWebPreview(m)
	}
	return out, nil
}

func entitiesEqual(a, b domain.MessageEntities) bool {
	ra, _ := json.Marshal(a)
	rb, _ := json.Marshal(b)
	return bytes.Equal(ra, rb)
}

// ── Снятие ──────────────────────────────────────────────────────────────────

// DeleteScheduled — messages.deleteScheduledMessages{peer, id[]}: свои
// отложенные чата снимаются одной транзакцией с кадром
// updateDeleteScheduledMessages (tweb :12606-12613). Чужие и уже снятые ключи
// пропускаются.
//
// Оплаченное при постановке (платная группа) возвращается автору в той же
// транзакции — решение пользователя 2026-10-12, тем же refundScheduled, что
// отказ публикации: только за реально снятые строки и по их состоянию на
// момент снятия (у повтора после первого вхождения оплаты на строке уже нет —
// следующие вхождения платят при публикации). Строка, чьё сообщение этого
// срока уже вставлено (сбой между публикацией и снятием), — доставлена:
// без возврата.
func (i *Interactor) DeleteScheduled(ctx context.Context, chatID, userID int64, ids []int64) ([]domain.Update, error) {
	if i.scheduled == nil {
		return nil, domain.ErrNotFound
	}
	rows, err := i.scheduled.ByIDs(ctx, chatID, userID, ids)
	if err != nil {
		return nil, err
	}
	own := make([]int64, len(rows))
	for k, r := range rows {
		own[k] = r.ID
	}
	var upd *domain.UpdateDeleteScheduledMessages
	var balances map[int64]int64
	err = i.writeScheduled(ctx, userID, func(ctx context.Context) ([]scheduledFrame, error) {
		balances = map[int64]int64{}
		// Строку в аренде публикации снятие пропускает: её снимет сама
		// публикация кадром с sent_messages.
		gone, e := i.scheduled.DeleteUnclaimed(ctx, own)
		if e != nil || len(gone) == 0 {
			return nil, e
		}
		deleted := make([]int64, len(gone))
		var toRefund []domain.ScheduledMessage
		for k, r := range gone {
			deleted[k] = r.ID
			if r.PaidStars <= 0 {
				continue
			}
			if _, e := i.msgs.FindByClientMsgID(ctx, r.ChatID, r.SenderID, publishKey(r)); e == nil {
				continue // уже доставлено
			} else if !errors.Is(e, domain.ErrNotFound) {
				return nil, e
			}
			toRefund = append(toRefund, r)
		}
		if e := i.refundScheduledBatch(ctx, toRefund, balances); e != nil {
			return nil, e
		}
		slices.Sort(deleted)
		u, e := i.scheduledDeleteUpdate(ctx, chatID, userID, deleted, nil)
		if e != nil {
			return nil, e
		}
		upd = &u
		body, e := updateBody(u)
		if e != nil {
			return nil, e
		}
		return []scheduledFrame{{typ: scheduledDeleteFrame, body: body}}, nil
	})
	if err != nil || upd == nil {
		return nil, err
	}
	for uid, bal := range balances {
		i.publishBalance(ctx, uid, bal)
	}
	return []domain.Update{*upd}, nil
}

// ── Публикация ──────────────────────────────────────────────────────────────

// SendScheduledNow — messages.sendScheduledMessages{peer, id[]}: опубликовать
// свои отложенные сейчас. Ключ элемента альбома публикует весь альбом (tweb
// getMidsByMid → sendScheduledMessages, contextMenu.ts:2042-2048). Ответ —
// updateDeleteScheduledMessages с номерами опубликованных. Отказ гейта
// публикации возвращается ошибкой, а строка остаётся автору (tweb не глушит
// ошибку sendScheduledMessages, appMessagesManager.ts:12420-12427).
func (i *Interactor) SendScheduledNow(ctx context.Context, chatID, userID int64, ids []int64) ([]domain.Update, error) {
	if i.scheduled == nil {
		return nil, domain.ErrNotFound
	}
	rows, err := i.scheduled.ByIDs(ctx, chatID, userID, ids)
	if err != nil {
		return nil, err
	}
	rows, err = i.withAlbums(ctx, rows)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, domain.ErrNotFound
	}
	updates, _, err := i.publishScheduled(ctx, chatID, userID, rows, true)
	if err != nil {
		return nil, err
	}
	return updates, nil
}

// withAlbums дополняет набор остальными элементами их отложенных альбомов.
func (i *Interactor) withAlbums(ctx context.Context, rows []domain.ScheduledMessage) ([]domain.ScheduledMessage, error) {
	seen := map[int64]bool{}
	groups := map[int64]bool{}
	var out []domain.ScheduledMessage
	add := func(r domain.ScheduledMessage) {
		if !seen[r.ID] {
			seen[r.ID] = true
			out = append(out, r)
		}
	}
	for _, r := range rows {
		add(r)
		g := r.Params.GroupedID
		if g == 0 || groups[g] {
			continue
		}
		groups[g] = true
		album, err := i.scheduled.ByGroupedID(ctx, r.ChatID, r.SenderID, g)
		if err != nil {
			return nil, err
		}
		for _, a := range album {
			add(a)
		}
	}
	slices.SortFunc(out, func(a, b domain.ScheduledMessage) int { return int(a.ID - b.ID) })
	return out, nil
}

// DispatchDueScheduled публикует созревшие отложенные (фоновый воркер, тик
// 15 с): по времени и «когда в сети» — у собеседников, которые сейчас в
// сети. Ожидания «когда в сети» проверяются ВСЕ на каждом тике (НО-2):
// прежнее окно LIMIT 50 по created_at голодало, если 50 самых старых ждали
// офлайн-собеседников.
func (i *Interactor) DispatchDueScheduled(ctx context.Context) (int, error) {
	if i.scheduled == nil {
		return 0, nil
	}
	due, err := i.scheduled.Due(ctx, time.Now(), 50)
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, m := range due {
		_, n, _ := i.publishScheduled(ctx, m.ChatID, m.SenderID, []domain.ScheduledMessage{m}, false)
		sent += n
	}
	// «Когда в сети»: без presence-подсистемы просто ждут.
	if i.presence == nil {
		return sent, nil
	}
	waits, err := i.scheduled.WhenOnlineWaits(ctx)
	if err != nil {
		return sent, err
	}
	online := map[int64]bool{}
	for _, w := range waits {
		on, known := online[w.PeerID]
		if !known {
			on, err = i.presence.IsOnline(ctx, w.PeerID)
			on = on && err == nil
			online[w.PeerID] = on
		}
		if !on {
			continue
		}
		rows, err := i.scheduled.WhenOnlineIn(ctx, w.ChatID, w.SenderID)
		if err != nil {
			return sent, err
		}
		_, n, _ := i.publishScheduled(ctx, w.ChatID, w.SenderID, rows, false)
		sent += n
	}
	return sent, nil
}

// privatePeer возвращает собеседника приватного чата (участника, отличного от
// senderID); 0 — если чат не приватный или собеседник не найден.
func (i *Interactor) privatePeer(ctx context.Context, chatID, senderID int64) int64 {
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil || typ != domain.ChatTypePrivate {
		return 0
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return 0
	}
	for _, uid := range members {
		if uid != senderID {
			return uid
		}
	}
	return 0
}

// scheduledLease — аренда строки на публикацию: держится на время Send и до
// снятия строки (истекает сама, если процесс упал посередине).
const scheduledLease = 2 * time.Minute

// scheduledRetry — отступ воркера после временного сбоя публикации. Аренда
// при этом снимается: автор может править и снимать строку.
const scheduledRetry = 2 * time.Minute

// maxPublishAttempts — попыток публикации одного срока; дальше строка
// снимается как отвергнутая (иначе стабильно падающие строки вечно занимали
// бы окно Due).
const maxPublishAttempts = 10

// publishScheduled публикует строки одного автора в одном чате и снимает их
// из очереди одной транзакцией с кадрами:
//
//   - опубликованные — updateDeleteScheduledMessages{messages, sent_messages};
//   - отвергнутые при публикации воркером (выгнали, закрыли тему, сняли
//     право, кончились попытки, снимок не читается) —
//     updateDeleteScheduledMessages{messages} без sent_messages: строка всё
//     равно уходит, а устройства автора должны об этом узнать;
//   - с повтором (schedule_repeat_period) — перепостановка на следующий срок,
//     тот же id: updateNewScheduledMessage (правка даты, как «Изменить время»).
//
// Каждая строка сперва берётся в аренду (Claim) и перечитывается свежей:
// снятую, перенесённую или уже публикуемую строку публикация пропускает, а
// правка и снятие не трогают строку в аренде — без этого они гонялись с
// публикацией (призрачные кадры, потерянные правки).
//
// strict — «Отправить сейчас» автором: первый отказ или сбой возвращается
// ошибкой, аренда снимается, строка остаётся (уже опубликованные до отказа
// снимаются как обычно).
//
// Возвращает апдейты для ответа ручке (send_now) и число опубликованных.
func (i *Interactor) publishScheduled(ctx context.Context, chatID, userID int64, rows []domain.ScheduledMessage,
	strict bool) ([]domain.Update, int, error) {
	var published, rejected []int64
	refundOf := map[int64]domain.ScheduledMessage{} // отвергнутые с оплатой постановки
	seqOf := map[int64]int64{}                      // ключ отложенного → номер опубликованного
	var repeats []domain.ScheduledMessage
	now := time.Now()
	sent := 0
	var failed error
	for _, snap := range rows {
		// Попыткой считается только аренда воркера: неудачные «Отправить
		// сейчас» не приближают снятие строки по пределу попыток.
		row, ok, err := i.scheduled.Claim(ctx, snap.ID, snap.SendAt, snap.WhenOnline, scheduledLease, !strict)
		if err != nil {
			log.Printf("scheduled %d: claim: %v", snap.ID, err)
			if strict {
				failed = err
				break
			}
			continue
		}
		if !ok {
			continue // сняли, перенесли или публикуют рядом
		}
		msg, err := i.publishScheduledRow(ctx, row, !strict && row.Attempts > maxPublishAttempts)
		if err != nil {
			if strict {
				if e := i.scheduled.Release(ctx, row.ID, 0); e != nil {
					log.Printf("scheduled %d: release: %v", row.ID, e)
				}
				failed = err
				break
			}
			if publishRefused(err) {
				rejected = append(rejected, row.ID)
				if row.PaidStars > 0 {
					refundOf[row.ID] = row
				}
				continue
			}
			// Сбой (БД, таймаут) — строка ждёт отступа: повтор идемпотентен
			// по ключу публикации, а снять её значило бы потерять сообщение и
			// списанные при постановке звёзды. Аренда снимается — правка и
			// снятие автором в это время работают.
			log.Printf("scheduled %d: publish: %v", row.ID, err)
			if e := i.scheduled.Release(ctx, row.ID, scheduledRetry); e != nil {
				log.Printf("scheduled %d: release: %v", row.ID, e)
			}
			continue
		}
		sent++
		if row.RepeatPeriod > 0 && !row.WhenOnline {
			repeats = append(repeats, row)
			continue
		}
		published = append(published, row.ID)
		seqOf[row.ID] = msg.Seq
	}
	var out []domain.Update
	var balances map[int64]int64
	err := i.writeScheduled(ctx, userID, func(ctx context.Context) ([]scheduledFrame, error) {
		out, balances = out[:0], map[int64]int64{}
		var frames []scheduledFrame
		// sent_messages — по позициям messages (schema layer.d.ts:3313-3316):
		// номер опубликованного для каждой РЕАЛЬНО снятой строки.
		var deletedRejected []int64
		del := func(ids []int64, withSent bool) error {
			deleted, e := i.scheduled.DeleteIDs(ctx, ids)
			if e != nil || len(deleted) == 0 {
				return e
			}
			if !withSent {
				deletedRejected = deleted
			}
			slices.Sort(deleted)
			var sentSeqs []int64
			if withSent {
				for _, id := range deleted {
					sentSeqs = append(sentSeqs, seqOf[id])
				}
			}
			u, e := i.scheduledDeleteUpdate(ctx, chatID, userID, deleted, sentSeqs)
			if e != nil {
				return e
			}
			body, e := updateBody(u)
			if e != nil {
				return e
			}
			out = append(out, u)
			frames = append(frames, scheduledFrame{typ: scheduledDeleteFrame, body: body})
			return nil
		}
		if e := del(published, true); e != nil {
			return nil, e
		}
		if e := del(rejected, false); e != nil {
			return nil, e
		}
		// Возврат звёзд отвергнутым — в той же транзакции, что снятие, и
		// только за РЕАЛЬНО снятые строки (DeleteIDs отдаёт каждую ровно
		// одному снятию): повторная попытка воркера второй раз не вернёт.
		var refunds []domain.ScheduledMessage
		for _, id := range deletedRejected {
			if r, ok := refundOf[id]; ok {
				refunds = append(refunds, r)
			}
		}
		if e := i.refundScheduledBatch(ctx, refunds, balances); e != nil {
			return nil, e
		}
		// Перепостановка повтора — условно, по опубликованному сроку: только
		// срок и счётчик вхождений, текст и прочее остаются как в строке.
		var moved []domain.ScheduledMessage
		for _, r := range repeats {
			nr, ok, e := i.scheduled.Reschedule(ctx, r.ID, r.SendAt, nextRepeat(r.SendAt, r.RepeatPeriod, now))
			if e != nil {
				return nil, e
			}
			if ok {
				moved = append(moved, nr)
			}
		}
		nf, nu, e := i.scheduledNewFrames(ctx, moved)
		if e != nil {
			return nil, e
		}
		out = append(out, nu...)
		return append(frames, nf...), nil
	})
	if err == nil {
		for uid, bal := range balances {
			i.publishBalance(ctx, uid, bal)
		}
	}
	if err != nil {
		// Сообщения уже опубликованы; строки снимет следующий проход после
		// истечения аренды (ключ публикации не даст дубля).
		log.Printf("scheduled: finish publish in chat %d: %v", chatID, err)
		if failed == nil && strict {
			failed = err
		}
	}
	return out, sent, failed
}

// refundScheduled возвращает автору звёзды, списанные при постановке
// отвергнутого отложенного (решение пользователя 2026-10-11) или снятого
// самим автором (2026-10-12): тем же
// движением баланса, что и списание (chargePaidMessage), в обратную сторону.
// Получатель (владелец группы) отдаёт полученное, но не больше своего
// баланса (атомарно, TakeUpTo): звёзды он мог уже потратить, а
// отрицательного баланса нет —
// осознанное отступление, в tweb не видно, как поступает сервер Telegram.
// balances — новые балансы для updateStarsBalance после коммита (клиент
// tweb обновляет баланс по нему, appPaymentsManager.ts:33-35, :420-428).
func (i *Interactor) refundScheduled(ctx context.Context, r domain.ScheduledMessage, balances map[int64]int64) error {
	if i.stars == nil || r.PaidStars <= 0 {
		return nil
	}
	bal, err := i.stars.AddBalance(ctx, r.SenderID, r.PaidStars)
	if err != nil {
		return err
	}
	balances[r.SenderID] = bal
	if r.PaidTo == 0 {
		return nil
	}
	cbal, err := i.stars.TakeUpTo(ctx, r.PaidTo, r.PaidStars)
	if err != nil {
		return err
	}
	balances[r.PaidTo] = cbal
	return nil
}

// refundScheduledBatch — возврат за набор строк одной транзакцией: строки балансов всех
// участвующих берутся заранее по возрастанию user_id (lockBalances), иначе порядок строк
// набора ломал бы общий порядок блокировок и взаимоблокировал бы возврат с платной отправкой.
func (i *Interactor) refundScheduledBatch(ctx context.Context, rows []domain.ScheduledMessage, balances map[int64]int64, alsoLock ...int64) error {
	if i.stars == nil {
		return nil
	}
	// alsoLock - балансы того же вызывающего (вклад розыгрышей при удалении
	// канала): одним проходом с остальными, иначе общий порядок блокировок рвётся.
	ids := append([]int64(nil), alsoLock...)
	for _, r := range rows {
		if r.PaidStars > 0 {
			ids = append(ids, r.SenderID, r.PaidTo)
		}
	}
	if err := i.lockBalances(ctx, ids...); err != nil {
		return err
	}
	for _, r := range rows {
		if err := i.refundScheduled(ctx, r, balances); err != nil {
			return err
		}
	}
	return nil
}

// lockScheduledForPublish — в транзакции вставки опубликованного: строка
// очереди под блокировкой до коммита. Снятие автором (DELETE) ждёт её и
// после коммита видит вставленное сообщение по ключу публикации — без
// возврата за доставленное; уже снятую строку публикация не вставляет
// (аренда могла истечь посреди долгой публикации).
func (i *Interactor) lockScheduledForPublish(ctx context.Context, id int64) error {
	if id == 0 || i.scheduled == nil {
		return nil
	}
	ok, err := i.scheduled.LockForPublish(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	return nil
}

// refundScheduledOfChat — удаление группы: оплаченные отложенные чата
// снимаются и возвращаются авторам (в транзакции удаления).
func (i *Interactor) refundScheduledOfChat(ctx context.Context, chatID int64, balances map[int64]int64, alsoLock ...int64) error {
	if i.scheduled == nil || i.stars == nil {
		// Очереди нет, но балансы вызывающего всё равно берутся одним проходом.
		return i.lockBalances(ctx, alsoLock...)
	}
	rows, err := i.scheduled.TakePaidByChat(ctx, chatID)
	if err != nil {
		return err
	}
	return i.refundScheduledBatch(ctx, rows, balances, alsoLock...)
}

// publishRefused — отказ публикации по существу (выгнали из чата, сняли
// право, закрыли тему, блок, исходник пересылки удалён): строка снимается с
// кадром без sent_messages. Прочие ошибки — сбои, строка ждёт следующей попытки.
func publishRefused(err error) bool {
	for _, e := range []error{domain.ErrNotFound, domain.ErrForbidden, domain.ErrPrivacy, domain.ErrInvalid,
		domain.ErrTooLong, domain.ErrBalanceTooLow, domain.ErrSlowmode} {
		if errors.Is(err, e) {
			return true
		}
	}
	// Цена выросла выше согласия постановки: повтор без согласия не уходит.
	var need domain.ErrAllowPaymentRequired
	return errors.As(err, &need)
}

// nextRepeat — следующий срок повтора: от прежнего срока шагами периода, пока
// не окажется в будущем (пропущенные из-за простоя сроки не догоняются).
// «Отправить сейчас» до срока расходует ближайшее вхождение: следующее — через
// период от него (по tweb не определить, сервер Telegram не виден).
func nextRepeat(at time.Time, period int, now time.Time) time.Time {
	step := time.Duration(period) * time.Second
	next := at.Add(step)
	for !next.After(now) {
		next = next.Add(step)
	}
	return next
}

// publishScheduledRow — сама публикация строки. Обычное отложенное — тот же
// Send со снимком: ключ идемпотентности публикации строится из ключа строки и
// срока, поэтому повторный проход воркера (сбой между Send и снятием строки)
// дубля не создаёт, а каждый срок повтора — своё сообщение. Готовое превью
// переносится в сообщение (webPage), без повторной сборки.
//
// Уже вставленное этим сроком сообщение (сбой между публикацией и снятием
// строки) отдаётся ДО гейтов: иначе потеря права за это время сняла бы строку
// как отвергнутую, хотя сообщение в чате есть.
//
// Каждое вхождение повтора после первого платит при публикации
// (repeatOccurrence): первое оплачено при постановке.
//
// Не публикуются (ErrInvalid — снятие как отвергнутой) строка с нечитаемым
// снимком и строка, исчерпавшая попытки воркера (giveUp) — но только если
// сообщение этого срока ещё не вставлено.
func (i *Interactor) publishScheduledRow(ctx context.Context, row domain.ScheduledMessage, giveUp bool) (domain.Message, error) {
	key := publishKey(row)
	if ex, err := i.msgs.FindByClientMsgID(ctx, row.ChatID, row.SenderID, key); err == nil {
		return ex, nil
	} else if !errors.Is(err, domain.ErrNotFound) {
		return domain.Message{}, err
	}
	if row.ParamsBroken {
		log.Printf("scheduled %d: snapshot params unreadable", row.ID)
		return domain.Message{}, domain.ErrInvalid
	}
	if giveUp {
		log.Printf("scheduled %d: gave up after %d attempts", row.ID, row.Attempts-1)
		return domain.Message{}, domain.ErrInvalid
	}
	if row.Params.Fwd != nil {
		return i.publishScheduledCopy(ctx, row, key)
	}
	in := sendInputOf(row)
	in.ScheduleRepeatPeriod = 0
	in.ClientMsgID = key
	in.fromSchedule = true
	in.repeatOccurrence = row.Occurrence > 0
	in.scheduledID = row.ID
	in.webPage = row.WebPage
	return i.Send(ctx, in)
}

// publishKey — ключ идемпотентности публикации: строка + срок (у повтора
// каждый срок — своё сообщение).
func publishKey(row domain.ScheduledMessage) string {
	return fmt.Sprintf("sched:%d:%d", row.ID, row.SendAt.Unix())
}

// publishScheduledCopy — публикация отложенной пересылки: копия из снимка тем
// же deliverForwardCopies, что и обычная пересылка (атрибуция, платное
// предложение, счётчик пересылок исходника, зеркало поста). Гейты — членство
// и право писать, без медленного режима и без повторной платы (В-2).
func (i *Interactor) publishScheduledCopy(ctx context.Context, row domain.ScheduledMessage, key string) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, row.ChatID, row.SenderID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	f := row.Params.Fwd
	c := row.Message()
	c.Seq, c.ClientMsgID, c.CreatedAt = 0, &key, time.Time{}
	c.PaidMediaPrice = nil // цену ставит предложение исходника (offers)
	c.MediaUnread = c.Type == "voice" || c.Type == "roundVideo"
	c.FromScheduled = true
	typ, err := i.chats.ChatType(ctx, row.ChatID)
	if err != nil {
		return domain.Message{}, err
	}
	broadcast := typ == domain.ChatTypeChannel
	in := ForwardInput{
		ToChatID: row.ChatID, SenderID: row.SenderID, Silent: row.Params.Silent,
		ThreadRootID: row.Params.ThreadRootID, fromSchedule: true, repeatOccurrence: row.Occurrence > 0,
		scheduledID: row.ID,
	}
	if row.Params.AllowPaidStars != nil {
		in.AllowPaidStars = *row.Params.AllowPaidStars
	} else {
		in.paidConsentNotRequired = true // строка до деплоя: платит как раньше
	}
	if err := i.checkForwardAllowed(ctx, in, []domain.Message{c}, 1, broadcast); err != nil {
		return domain.Message{}, err
	}
	var offers map[int64]PaidOffer
	if f.OfferPrice > 0 {
		offers = map[int64]PaidOffer{f.SrcMsgID: {Price: f.OfferPrice, OfferID: f.OfferID}}
	}
	msgs, err := i.deliverForwardCopies(ctx, in, []int64{f.SrcMsgID}, []domain.Message{c}, offers, broadcast)
	if err != nil {
		return domain.Message{}, err
	}
	if len(msgs) != 1 {
		return domain.Message{}, errors.New("scheduled copy: nothing published")
	}
	return msgs[0], nil
}
