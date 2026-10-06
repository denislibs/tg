package chat

import (
	"context"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Звонок 1:1 и его лог.
//
// Сервер переадресует сигналинг (call_request / call_accept / call_decline /
// call_end / call_signal) девайсам собеседника — медиа идёт P2P под DTLS, его
// содержимое серверу не нужно. Но лог звонка — служебное сообщение
// messageActionPhoneCall в личном чате — кладёт САМ сервер, когда звонок
// кончился, как у оригинала: там сообщение рождает phone.discardCall, а клиент
// в чат ничего не отправляет (tweb callInstance.ts:888 — только discardCall с
// причиной и длительностью). Ради этого сервер ведёт состояние звонка
// (PhoneCallStore): кто звонит, кому, с видео ли и когда ответили. Исход и
// длительность считаются по нему, а не берутся у клиента.
//
// Из подсказок клиента сервер берёт только то, чего сам знать не может:
// у звонка без ответа — «истёк звонок у адресата» (missed) против «адресат
// отклонил/занят»; у состоявшегося — «оборвалась связь» (disconnect) против
// «положили трубку».

// Подсказки исхода в поле reason кадров call_end / call_decline.
const (
	// callHintMissed — у адресата истёк звонок (call_decline) либо у звонящего
	// истекло ожидание ответа (call_end).
	callHintMissed = "missed"
	// callHintDisconnect — разговор оборвался связью, а не кнопкой (call_end).
	callHintDisconnect = "disconnect"
)

// maxCallIDLen — call_id у клиента uuid (36); длиннее — не наш кадр.
const maxCallIDLen = 64

// callAnsweredElsewhere — причина call_end, которым сервер гасит звонок на
// остальных устройствах вызываемого, когда он ответил или отклонил на одном
// (у оригинала — updatePhoneCall с phoneCallDiscarded другим сессиям; tweb
// callsController.handleCallUpdate закрывает такой звонок).
const callAnsweredElsewhere = "answered_elsewhere"

// RelayCall переадресует кадр сигналинга 1:1 звонка всем девайсам адресата,
// проставляя from_user_id на сервере (подделать отправителя нельзя), и ведёт
// состояние звонка ради его лога.
//
// call_request дополнительно гейтится правилом «кто может мне звонить» +
// чёрным списком: запрещённый вызов сразу отвечает инициатору call_decline
// reason=privacy (адресат ничего не видит, как в Telegram), и звонок не
// заводится вовсе — лога у него нет, как у отказа USER_PRIVACY_RESTRICTED.
//
// Остальные кадры живут только в рамках звонка (phone.acceptCall,
// phone.sendSignalingData у оригинала адресуются звонком): call_id должен
// существовать, и отправитель с адресатом — его стороны; ответить или
// отклонить может только вызываемый и только до ответа. Иначе посторонний
// оборвал бы чужой разговор кадром call_end, а второе устройство вызываемого
// через 45 с звонка — уже идущий разговор своим call_decline{missed}.
func (i *Interactor) RelayCall(ctx context.Context, frameType string, fromUserID, toUserID int64, data map[string]any) error {
	if i.publisher == nil || toUserID == 0 || toUserID == fromUserID {
		return nil
	}
	if data == nil {
		data = map[string]any{}
	}
	callID, _ := data["call_id"].(string)
	hint, _ := data["reason"].(string)
	if i.phoneCalls != nil && !validCallID(callID) {
		return nil // кадр вне звонка
	}
	var stateErr error
	if frameType == "call_request" {
		if i.privacy != nil {
			ok, err := i.privacy.Check(ctx, toUserID, fromUserID, domain.PrivacyCalls)
			if err != nil {
				return err
			}
			if !ok {
				decline := frame("call_decline", map[string]any{"from_user_id": toUserID, "call_id": callID, "reason": "privacy"})
				return i.publisher.PublishToUser(ctx, fromUserID, decline)
			}
		}
		video, _ := data["video"].(bool)
		ok, err := i.openPhoneCall(ctx, domain.PhoneCall{ID: callID, CallerID: fromUserID, CalleeID: toUserID, Video: video})
		if err != nil || !ok {
			return err
		}
	} else if i.phoneCalls != nil {
		c, err := i.phoneCalls.Get(ctx, callID)
		if errors.Is(err, domain.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if !c.IsParty(fromUserID) || !c.IsParty(toUserID) {
			return nil
		}
		if (frameType == "call_accept" || frameType == "call_decline") && (fromUserID != c.CalleeID || c.Answered()) {
			return nil
		}
	}
	if frameType == "call_accept" {
		// Ответ релеится только победителю гонки двух устройств: второй
		// call_accept звонящему не уходит (иначе — два offer/answer, glare).
		won, err := i.acceptPhoneCall(ctx, callID, fromUserID)
		if err != nil || !won {
			return err
		}
	}
	data["from_user_id"] = fromUserID
	err := i.publisher.PublishToUser(ctx, toUserID, frame(frameType, data))
	// Ответил или отклонил на одном устройстве — остальные устройства
	// вызываемого перестают звонить. Кадр уходит всем его соединениям: то,
	// которое ответило, его узнаёт (своё from_user_id, фаза уже не «входящий»)
	// и пропускает — одно соединение воркера обслуживает все вкладки браузера,
	// поэтому «кроме исходного соединения» вкладки бы не погасило.
	if frameType == "call_accept" || frameType == "call_decline" {
		err = errors.Join(err, i.publisher.PublishToUser(ctx, fromUserID, frame("call_end", map[string]any{
			"from_user_id": fromUserID, "call_id": callID, "reason": callAnsweredElsewhere,
		})))
	}
	// Лог — после кадра: экран звонка у собеседника гаснет без ожидания записи.
	if frameType == "call_decline" || frameType == "call_end" {
		stateErr = i.discardPhoneCall(ctx, callID, fromUserID, hint)
	}
	return errors.Join(err, stateErr)
}

func validCallID(id string) bool { return id != "" && len(id) <= maxCallIDLen }

// openPhoneCall заводит звонок. Повтор call_request с тем же call_id состояние
// не трогает (Create — «если нет») и пропускается, только если это тот же
// звонок тех же сторон: чужой call_id не перехватить. Без хранилища звонков —
// как прежде, без сверки.
func (i *Interactor) openPhoneCall(ctx context.Context, c domain.PhoneCall) (bool, error) {
	if i.phoneCalls == nil {
		return true, nil
	}
	created, err := i.phoneCalls.Create(ctx, c)
	if err != nil || created {
		return created, err
	}
	cur, err := i.phoneCalls.Get(ctx, c.ID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return cur.CallerID == c.CallerID && cur.CalleeID == c.CalleeID, nil
}

// acceptPhoneCall отмечает ответ — только от адресата этого звонка. true —
// ответ этого устройства принят (оно первое); без хранилища — всегда.
func (i *Interactor) acceptPhoneCall(ctx context.Context, callID string, byUserID int64) (bool, error) {
	if i.phoneCalls == nil {
		return true, nil
	}
	if !validCallID(callID) {
		return false, nil
	}
	c, err := i.phoneCalls.Get(ctx, callID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if c.CalleeID != byUserID {
		return false, nil
	}
	return i.phoneCalls.Accept(ctx, callID, time.Now())
}

// discardPhoneCall кончает звонок и кладёт его лог в личный чат сторон.
//
// Ровно одна запись на звонок: Finish отдаёт звонок одному из конкурентов,
// поэтому call_end от обеих сторон (или call_end + call_decline) пишут лог
// единожды. Чужой звонок кончить нельзя — сверка участника идёт до Finish.
func (i *Interactor) discardPhoneCall(ctx context.Context, callID string, byUserID int64, hint string) error {
	if i.phoneCalls == nil || !validCallID(callID) {
		return nil
	}
	c, err := i.phoneCalls.Get(ctx, callID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if !c.IsParty(byUserID) {
		return nil
	}
	c, err = i.phoneCalls.Finish(ctx, callID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil // звонок уже кончила другая сторона — лог написан ею
	}
	if err != nil {
		return err
	}
	chatID, err := i.CreatePrivateChat(ctx, c.CallerID, c.CalleeID)
	if err != nil {
		return err
	}
	// От звонящего: у него бабл «Исходящий», у адресата — «Входящий» /
	// «Пропущенный» / «Отклонённый» (tweb wrappers/callBubble.ts:48-69).
	_, err = i.Send(ctx, SendInput{
		ChatID: chatID, SenderID: c.CallerID,
		Action: phoneCallOutcome(c, byUserID, hint, time.Now()),
	})
	return err
}

// phoneCallOutcome — исход звонка: причина и длительность.
//
//   - Ответили: длительность — от ответа до конца, целыми секундами вниз (как
//     tweb `duration`, callInstance.ts:851); причина Hangup, а если сторона
//     сообщила об обрыве связи — Disconnect.
//   - Не ответили, кончил звонящий (сдался сам или истекло ожидание): Missed —
//     tdesktop Call::hangup, «исходящий без ответа — пропущенный»; у звонящего
//     это рисуется «Отменённым», у адресата «Пропущенным».
//   - Не ответили, кончил адресат: у него истёк звонок — Missed, иначе он
//     отклонил или занят — Busy (у адресата «Отклонённый»).
func phoneCallOutcome(c domain.PhoneCall, byUserID int64, hint string, at time.Time) domain.MessageActionPhoneCall {
	if c.Answered() {
		d := max(int(at.Sub(c.AcceptedAt)/time.Second), 0)
		var reason domain.PhoneCallDiscardReason = domain.NewPhoneCallDiscardReasonHangup()
		if hint == callHintDisconnect {
			reason = domain.NewPhoneCallDiscardReasonDisconnect()
		}
		return domain.NewMessageActionPhoneCall(c.Video, reason, &d)
	}
	if byUserID == c.CallerID || hint == callHintMissed {
		return domain.NewMessageActionPhoneCall(c.Video, domain.NewPhoneCallDiscardReasonMissed(), nil)
	}
	return domain.NewMessageActionPhoneCall(c.Video, domain.NewPhoneCallDiscardReasonBusy(), nil)
}
