package chat

import "github.com/messenger-denis/backend/internal/domain"

// Лог звонка — служебное сообщение, а не «сообщение вида call».
//
// Прежде это была строка с type == "call", чей ТЕКСТ был JSON
// {video, reason, duration}: та же подделка дискриминатора, что у служебных
// действий, только в другом поле — и клиент разбирал её тем же
// `raw.startsWith('{')`. В схеме это messageActionPhoneCall, то есть обычное
// служебное сообщение, и вкладка «Звонки» у оригинала собирается ровно из них.
//
// Колонка messages.type == 'call' остаётся ВНУТРЕННЕЙ: по ней идёт выборка
// журнала звонков (MessagesRepo.CallLog). Наружу вид сообщения не выходит.

// CallReason — как кончился звонок глазами клиента, который его вёл.
const (
	CallReasonMissed    = "missed"
	CallReasonBusy      = "busy"
	CallReasonCancelled = "cancelled"
	CallReasonOK        = "ok"
)

// PhoneCallAction переводит исход звонка в конструктор схемы.
//
// Наши четыре причины ложатся на схему тремя конструкторами: `ok` и
// `cancelled` дают ОДИН phoneCallDiscardReasonHangup, а различает их НАЛИЧИЕ
// duration — у соединившегося звонка длительность есть, у сорвавшегося нет.
// Именно так читает оригинал, и лишнего конструктора для этого не нужно.
//
// call_id (обязательный по схеме) не производится: идентификатор звонка у нас
// живёт только в сигнальных кадрах и на сообщение не сохраняется — названо в
// domain.MessageActionPhoneCall.
func PhoneCallAction(video bool, reason string, duration int) domain.MessageActionPhoneCall {
	var r domain.PhoneCallDiscardReason
	switch reason {
	case CallReasonMissed:
		r = domain.NewPhoneCallDiscardReasonMissed()
	case CallReasonBusy:
		r = domain.NewPhoneCallDiscardReasonBusy()
	default:
		r = domain.NewPhoneCallDiscardReasonHangup()
	}
	if duration < 0 {
		duration = 0
	}
	return domain.NewMessageActionPhoneCall(video, r, duration)
}
