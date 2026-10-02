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

// RelayCall переадресует кадр сигналинга 1:1 звонка всем девайсам адресата,
// проставляя from_user_id на сервере (подделать отправителя нельзя), и ведёт
// состояние звонка ради его лога.
//
// call_request дополнительно гейтится правилом «кто может мне звонить» +
// чёрным списком: запрещённый вызов сразу отвечает инициатору call_decline
// reason=privacy (адресат ничего не видит, как в Telegram), и звонок не
// заводится вовсе — лога у него нет, как у отказа USER_PRIVACY_RESTRICTED.
func (i *Interactor) RelayCall(ctx context.Context, frameType string, fromUserID, toUserID int64, data map[string]any) error {
	if i.publisher == nil || toUserID == 0 || toUserID == fromUserID {
		return nil
	}
	if frameType == "call_request" && i.privacy != nil {
		ok, err := i.privacy.Check(ctx, toUserID, fromUserID, domain.PrivacyCalls)
		if err != nil {
			return err
		}
		if !ok {
			decline := frame("call_decline", map[string]any{"from_user_id": toUserID, "reason": "privacy"})
			return i.publisher.PublishToUser(ctx, fromUserID, decline)
		}
	}
	if data == nil {
		data = map[string]any{}
	}
	callID, _ := data["call_id"].(string)
	hint, _ := data["reason"].(string)
	var stateErr error
	switch frameType {
	case "call_request":
		video, _ := data["video"].(bool)
		stateErr = i.openPhoneCall(ctx, domain.PhoneCall{ID: callID, CallerID: fromUserID, CalleeID: toUserID, Video: video})
	case "call_accept":
		stateErr = i.acceptPhoneCall(ctx, callID, fromUserID)
	}
	data["from_user_id"] = fromUserID
	err := i.publisher.PublishToUser(ctx, toUserID, frame(frameType, data))
	// Лог — после кадра: экран звонка у собеседника гаснет без ожидания записи.
	if frameType == "call_decline" || frameType == "call_end" {
		stateErr = i.discardPhoneCall(ctx, callID, fromUserID, hint)
	}
	return errors.Join(err, stateErr)
}

func validCallID(id string) bool { return id != "" && len(id) <= maxCallIDLen }

// openPhoneCall заводит звонок. Повтор call_request с тем же call_id состояние
// не трогает (Create — «если нет»).
func (i *Interactor) openPhoneCall(ctx context.Context, c domain.PhoneCall) error {
	if i.phoneCalls == nil || !validCallID(c.ID) {
		return nil
	}
	_, err := i.phoneCalls.Create(ctx, c)
	return err
}

// acceptPhoneCall отмечает ответ — только от адресата этого звонка.
func (i *Interactor) acceptPhoneCall(ctx context.Context, callID string, byUserID int64) error {
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
	if c.CalleeID != byUserID {
		return nil
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
