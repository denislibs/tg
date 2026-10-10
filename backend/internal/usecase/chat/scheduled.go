package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	return domain.ScheduledParams{
		ReplyToPeerID: in.ReplyToPeerID, ReplyQuoteText: in.ReplyQuoteText, ReplyQuoteOffset: in.ReplyQuoteOffset,
		ThreadRootID: in.ThreadRootID, GroupedID: in.GroupedID,
		PollID: in.PollID, ChecklistID: in.ChecklistID,
		GeoLat: in.GeoLat, GeoLng: in.GeoLng, GeoTitle: in.GeoTitle, GeoAddress: in.GeoAddress,
		GeoLivePeriod: in.GeoLivePeriod, GeoHeading: in.GeoHeading,
		ContactUserID: in.ContactUserID,
		Silent:        in.Silent, Effect: in.Effect, PaidMediaPrice: in.PaidMediaPrice,
		MediaSpoiler: in.MediaSpoiler, SendAsChatID: in.SendAsChatID,
	}
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
		ContactUserID: p.ContactUserID,
		Silent:        p.Silent, Effect: p.Effect, PaidMediaPrice: p.PaidMediaPrice,
		MediaSpoiler: p.MediaSpoiler, SendAsChatID: p.SendAsChatID,
		ScheduleRepeatPeriod: m.RepeatPeriod,
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
	sendAt, whenOnline, repeat, err := i.scheduleTiming(ctx, in.ChatID, in.SenderID, in.ScheduleDate, in.ScheduleRepeatPeriod)
	if err != nil {
		return domain.Message{}, err
	}
	row := scheduledRowOf(in)
	row.SendAt, row.WhenOnline, row.RepeatPeriod = sendAt, whenOnline, repeat
	// Карточка контакта — снимком для ленты (Send гидрирует её заново при
	// публикации, как и при обычной отправке).
	if in.Type == "contact" && in.ContactUserID != nil {
		c := i.userCard(ctx, *in.ContactUserID)
		name, phone := c.Title(), c.Phone
		row.Params.ContactName, row.Params.ContactPhone = &name, &phone
	}
	stored, created, err := i.putScheduled(ctx, in.ChatID, in.SenderID, []domain.ScheduledMessage{row}, []SendInput{in})
	if err != nil {
		return domain.Message{}, err
	}
	if created {
		i.clearDraftAfterSend(ctx, in.SenderID, in.ChatID)
	}
	return stored[0].Message(), nil
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
			ContactUserID: c.ContactUserID, ContactName: c.ContactName, ContactPhone: c.ContactPhone,
			Silent: in.Silent, MediaSpoiler: c.MediaSpoiler, Fwd: fwd,
		}
		if c.GroupedID != nil {
			p.GroupedID = *c.GroupedID
		}
		rows[idx] = domain.ScheduledMessage{
			ChatID: in.ToChatID, SenderID: in.SenderID, Type: c.Type, Text: c.Text, Entities: c.Entities,
			MediaID: c.MediaID, SendAt: sendAt, WhenOnline: whenOnline, RepeatPeriod: repeat,
			Params: p, WebPage: c.WebPage,
		}
		probes[idx] = sendProbe(in.ToChatID, in.SenderID, c)
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
		n, e := i.scheduled.CountByChat(ctx, chatID, senderID)
		if e != nil {
			return e
		}
		if n+len(fresh) > maxScheduledPerChat {
			return domain.ErrScheduleTooMuch
		}
		news := make([]domain.ScheduledMessage, 0, len(fresh))
		for _, idx := range fresh {
			ch, e := i.chargePaidMessage(ctx, probes[idx])
			if e != nil {
				return e
			}
			if ch.applied {
				charge = ch
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
	ChatID, ID, UserID   int64
	Text                 string
	Entities             domain.MessageEntities
	ScheduleDate         int64
	ScheduleRepeatPeriod int
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
		m.Params.GeoLat == nil && m.Params.ContactUserID == nil {
		return nil, domain.ErrMessageEmpty
	}
	textChanged := in.Text != m.Text || !entitiesEqual(entities, m.Entities)
	if textChanged && m.Params.Fwd != nil {
		return nil, domain.ErrForbidden // текст пересланного не правится
	}
	sendAt, whenOnline, repeat, err := i.scheduleTiming(ctx, m.ChatID, m.SenderID, in.ScheduleDate, in.ScheduleRepeatPeriod)
	if err != nil {
		return nil, err
	}
	timeChanged := whenOnline != m.WhenOnline || (!whenOnline && !sendAt.Equal(m.SendAt)) || repeat != m.RepeatPeriod
	if !textChanged && !timeChanged {
		return nil, domain.ErrMessageNotModified
	}
	group := []domain.ScheduledMessage{m}
	if g := m.Params.GroupedID; g != 0 && timeChanged {
		if group, err = i.scheduled.ByGroupedID(ctx, m.ChatID, m.SenderID, g); err != nil {
			return nil, err
		}
	}
	var out []domain.Update
	err = i.writeScheduled(ctx, m.SenderID, func(ctx context.Context) ([]scheduledFrame, error) {
		edited := make([]domain.ScheduledMessage, 0, len(group))
		for _, row := range group {
			if row.ID == m.ID {
				row.Text, row.Entities = in.Text, entities
			}
			if timeChanged {
				row.SendAt, row.WhenOnline, row.RepeatPeriod = sendAt, whenOnline, repeat
			}
			if e := i.scheduled.Update(ctx, row); e != nil {
				return nil, e
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
	err = i.writeScheduled(ctx, userID, func(ctx context.Context) ([]scheduledFrame, error) {
		deleted, e := i.scheduled.DeleteIDs(ctx, own)
		if e != nil || len(deleted) == 0 {
			return nil, e
		}
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
	return []domain.Update{*upd}, nil
}

// ── Публикация ──────────────────────────────────────────────────────────────

// SendScheduledNow — messages.sendScheduledMessages{peer, id[]}: опубликовать
// свои отложенные сейчас. Ключ элемента альбома публикует весь альбом (tweb
// getMidsByMid → sendScheduledMessages, contextMenu.ts:2042-2048). Ответ —
// updateDeleteScheduledMessages с номерами опубликованных.
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
	updates, _ := i.publishScheduled(ctx, chatID, userID, rows)
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
		_, n := i.publishScheduled(ctx, m.ChatID, m.SenderID, []domain.ScheduledMessage{m})
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
		_, n := i.publishScheduled(ctx, w.ChatID, w.SenderID, rows)
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

// publishScheduled публикует строки одного автора в одном чате и снимает их
// из очереди одной транзакцией с кадрами:
//
//   - опубликованные — updateDeleteScheduledMessages{messages, sent_messages};
//   - отвергнутые при публикации (выгнали, закрыли тему, сняли право) —
//     updateDeleteScheduledMessages{messages} без sent_messages: строка всё
//     равно уходит, иначе воркер ретраил бы её вечно, а устройства автора
//     должны об этом узнать;
//   - с повтором (schedule_repeat_period) — перепостановка на следующий срок,
//     тот же id: updateNewScheduledMessage (правка даты, как «Изменить время»).
//
// Возвращает апдейты для ответа ручке (send_now) и число опубликованных.
func (i *Interactor) publishScheduled(ctx context.Context, chatID, userID int64, rows []domain.ScheduledMessage) ([]domain.Update, int) {
	var published, rejected, sent []int64
	var repeats []domain.ScheduledMessage
	now := time.Now()
	for _, row := range rows {
		msg, err := i.publishScheduledRow(ctx, row)
		if err != nil {
			rejected = append(rejected, row.ID)
			continue
		}
		sent = append(sent, msg.Seq)
		if row.RepeatPeriod > 0 && !row.WhenOnline {
			row.SendAt = nextRepeat(row.SendAt, row.RepeatPeriod, now)
			repeats = append(repeats, row)
			continue
		}
		published = append(published, row.ID)
	}
	var out []domain.Update
	_ = i.writeScheduled(ctx, userID, func(ctx context.Context) ([]scheduledFrame, error) {
		out = out[:0]
		var frames []scheduledFrame
		del := func(ids, sentSeqs []int64) error {
			deleted, e := i.scheduled.DeleteIDs(ctx, ids)
			if e != nil || len(deleted) == 0 {
				return e
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
		if len(published) > 0 || len(sent) > 0 {
			if e := del(published, sent); e != nil {
				return nil, e
			}
		}
		if len(rejected) > 0 {
			if e := del(rejected, nil); e != nil {
				return nil, e
			}
		}
		for _, r := range repeats {
			if e := i.scheduled.Update(ctx, r); e != nil {
				return nil, e
			}
		}
		nf, nu, e := i.scheduledNewFrames(ctx, repeats)
		if e != nil {
			return nil, e
		}
		out = append(out, nu...)
		return append(frames, nf...), nil
	})
	return out, len(sent)
}

// nextRepeat — следующий срок повтора: от прежнего срока шагами периода, пока
// не окажется в будущем (пропущенные из-за простоя сроки не догоняются).
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
func (i *Interactor) publishScheduledRow(ctx context.Context, row domain.ScheduledMessage) (domain.Message, error) {
	if row.Params.Fwd != nil {
		return i.publishScheduledCopy(ctx, row)
	}
	in := sendInputOf(row)
	in.ScheduleRepeatPeriod = 0
	in.ClientMsgID = fmt.Sprintf("sched:%d:%d", row.ID, row.SendAt.Unix())
	in.fromSchedule = true
	in.webPage = row.WebPage
	return i.Send(ctx, in)
}

// publishScheduledCopy — публикация отложенной пересылки: копия из снимка тем
// же deliverForwardCopies, что и обычная пересылка (атрибуция, платное
// предложение, счётчик пересылок исходника, зеркало поста). Гейты — членство
// и право писать, без медленного режима и без повторной платы (В-2).
func (i *Interactor) publishScheduledCopy(ctx context.Context, row domain.ScheduledMessage) (domain.Message, error) {
	ok, err := i.chats.IsMember(ctx, row.ChatID, row.SenderID)
	if err != nil {
		return domain.Message{}, err
	}
	if !ok {
		return domain.Message{}, domain.ErrNotFound
	}
	f := row.Params.Fwd
	c := row.Message()
	c.Seq, c.ClientMsgID, c.CreatedAt = 0, nil, time.Time{}
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
		ThreadRootID: row.Params.ThreadRootID, fromSchedule: true,
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
